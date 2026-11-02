const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { analyzeFolders, executeSync } = require('../src/syncEngine');

async function createTempFile(baseDir, relPath, content, mtimeDate) {
  const fullPath = path.join(baseDir, ...relPath.split('/'));
  await fsp.mkdir(path.dirname(fullPath), { recursive: true });
  await fsp.writeFile(fullPath, content, 'utf-8');
  await fsp.utimes(fullPath, mtimeDate, mtimeDate);
}

async function runTests() {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mysync-test-'));
  const leftDir = path.join(tmpRoot, 'left');
  const rightDir = path.join(tmpRoot, 'right');
  await fsp.mkdir(leftDir, { recursive: true });
  await fsp.mkdir(rightDir, { recursive: true });

  const tOld = new Date('2026-01-10T10:00:00Z');
  const tNew = new Date('2026-01-10T12:00:00Z');
  const tSame = new Date('2026-01-05T08:00:00Z');

  // 1. Only on Left
  await createTempFile(leftDir, 'docs/only-left.txt', 'Left exclusive content', tNew);

  // 2. Only on Right
  await createTempFile(rightDir, 'docs/only-right.txt', 'Right exclusive content', tNew);

  // 3. Present on Both, Newer on Left
  await createTempFile(leftDir, 'shared/newer-on-left.txt', 'Updated left version', tNew);
  await createTempFile(rightDir, 'shared/newer-on-left.txt', 'Old right', tOld);

  // 4. Present on Both, Newer on Right
  await createTempFile(leftDir, 'shared/newer-on-right.txt', 'Old left', tOld);
  await createTempFile(rightDir, 'shared/newer-on-right.txt', 'Updated right version', tNew);

  // 5. Identical on Both
  await createTempFile(leftDir, 'shared/same.txt', 'Identical payload', tSame);
  await createTempFile(rightDir, 'shared/same.txt', 'Identical payload', tSame);

  // 6. Ignored file (.tmp)
  await createTempFile(leftDir, 'cache/temp.tmp', 'Should be ignored', tNew);

  // 7. Nested parent folder & subfolders to test Exclude Parent Folder
  await createTempFile(leftDir, '01_Only_Left/Finance/2026/Q1/budget.csv', 'Budget', tNew);
  await createTempFile(leftDir, '01_Only_Left/Finance/2026/Q2/Deep/forecast.csv', 'Forecast', tNew);

  // 8. Windows Protected OS AlbumArt file to test [Hidden] / [System] detection and skipHiddenSystem
  await createTempFile(rightDir, 'AlbumArt_{AC6324E1-727D-42FA-AA92-D7D4B060B8EE}_Large.jpg', 'FakeJPEG', tNew);

  console.log('--- Testing Left -> Right Analysis (With skipHiddenSystem = true & Exclude Parent Folder) ---');
  const analysisLR = await analyzeFolders({
    leftDir,
    rightDir,
    direction: 'left_to_right',
    propagateDeletions: false,
    skipHiddenSystem: true,
    excludePatterns: ['*.tmp', '01_Only_Left/Finance'],
  });

  assert.strictEqual(analysisLR.counts.total, 5, 'Should scan 5 non-excluded files');
  assert.strictEqual(analysisLR.counts.only_left, 1, 'Should detect 1 file only on left');
  assert.strictEqual(analysisLR.counts.only_right, 1, 'Should detect 1 file only on right');
  assert.strictEqual(analysisLR.counts.newer_left, 1, 'Should detect 1 file newer on left');
  assert.strictEqual(analysisLR.counts.newer_right, 1, 'Should detect 1 file newer on right');
  assert.strictEqual(analysisLR.counts.identical, 1, 'Should detect 1 identical file');

  const byPath = Object.fromEntries(analysisLR.items.map((i) => [i.relPath, i]));
  assert.strictEqual(byPath['docs/only-left.txt'].action, 'copy_to_right');
  assert.strictEqual(byPath['shared/newer-on-left.txt'].action, 'copy_to_right');
  assert.strictEqual(byPath['docs/only-right.txt'].action, 'skip');
  assert.strictEqual(byPath['shared/newer-on-right.txt'].action, 'skip');

  console.log('--- Testing Right -> Left Analysis (With Mirror Deletions & skipHiddenSystem = false) ---');
  const analysisRL = await analyzeFolders({
    leftDir,
    rightDir,
    direction: 'right_to_left',
    propagateDeletions: true,
    skipHiddenSystem: false,
    excludePatterns: ['*.tmp', '01_Only_Left/Finance'],
  });

  const byPathRL = Object.fromEntries(analysisRL.items.map((i) => [i.relPath, i]));
  assert.strictEqual(
    byPathRL['AlbumArt_{AC6324E1-727D-42FA-AA92-D7D4B060B8EE}_Large.jpg'].isHidden,
    true,
    'AlbumArt file should be flagged as Hidden'
  );
  assert.strictEqual(
    byPathRL['AlbumArt_{AC6324E1-727D-42FA-AA92-D7D4B060B8EE}_Large.jpg'].isSystem,
    true,
    'AlbumArt file should be flagged as System'
  );
  assert.strictEqual(byPathRL['docs/only-right.txt'].action, 'copy_to_left');
  assert.strictEqual(byPathRL['shared/newer-on-right.txt'].action, 'copy_to_left');
  assert.strictEqual(byPathRL['docs/only-left.txt'].action, 'delete_left');

  console.log('--- Testing Sync Execution (Left -> Right) ---');
  const execResult = await executeSync({
    leftDir,
    rightDir,
    operations: analysisLR.items,
  });

  assert.strictEqual(execResult.copiedToRight, 2, 'Should copy 2 files from Left to Right');
  assert.strictEqual(execResult.errors.length, 0, 'Should have 0 execution errors');

  const copiedContent = await fsp.readFile(path.join(rightDir, 'docs', 'only-left.txt'), 'utf-8');
  assert.strictEqual(copiedContent, 'Left exclusive content');

  const updatedContent = await fsp.readFile(
    path.join(rightDir, 'shared', 'newer-on-left.txt'),
    'utf-8'
  );
  assert.strictEqual(updatedContent, 'Updated left version');

  await fsp.rm(tmpRoot, { recursive: true, force: true });
  console.log('✅ All syncEngine unit tests passed!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

