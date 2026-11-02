const assert = require('assert');
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { populateSmartFolders, LEFT_ROOT, RIGHT_ROOT } = require('./setupAndTestFTemp');

// When run via `node test/e2eAppUI.test.js`, spawn through Electron without ELECTRON_RUN_AS_NODE
if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE) {
  const { spawn } = require('child_process');
  const electronPath = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, [__filename], { env, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
  return;
}

// Register the same IPC handlers from main.js by requiring main.js, then driving the window
require('../src/main');

async function runUITest() {
  await populateSmartFolders();

  // Wait for mainWindow to load
  await new Promise((r) => setTimeout(r, 1500));
  const win = BrowserWindow.getAllWindows()[0];
  assert(win, 'Main BrowserWindow should be created');

  const wc = win.webContents;

  console.log('--- [UI E2E] 1. Setting Left & Right folders in UI to F:\\temp\\SyncTest_Left & Right ---');
  await wc.executeJavaScript(`
    (async () => {
      const job = getActiveJob();
      job.leftDir = ${JSON.stringify(LEFT_ROOT)};
      job.rightDir = ${JSON.stringify(RIGHT_ROOT)};
      job.direction = 'left_to_right';
      job.propagateDeletions = false;
      renderActiveJobControls();
      await runAnalysis();
    })();
  `);

  const countsAfterAnalyze = await wc.executeJavaScript(`({
    all: document.getElementById('countAll').textContent,
    diffs: document.getElementById('countDifferences').textContent,
    onlyLeft: document.getElementById('countOnlyLeft').textContent,
    onlyRight: document.getElementById('countOnlyRight').textContent,
    newerLeft: document.getElementById('countNewerLeft').textContent,
    newerRight: document.getElementById('countNewerRight').textContent,
    identical: document.getElementById('countIdentical').textContent,
    planned: document.getElementById('plannedOpsCount').textContent,
  })`);

  console.log('UI Badge Counts after Analyze:', countsAfterAnalyze);
  assert.strictEqual(countsAfterAnalyze.all, '58');
  assert.strictEqual(countsAfterAnalyze.diffs, '48');
  assert.strictEqual(countsAfterAnalyze.onlyLeft, '15');
  assert.strictEqual(countsAfterAnalyze.onlyRight, '12');
  assert.strictEqual(countsAfterAnalyze.newerLeft, '10');
  assert.strictEqual(countsAfterAnalyze.newerRight, '8');
  assert.strictEqual(countsAfterAnalyze.identical, '10');
  assert.strictEqual(countsAfterAnalyze.planned, '28', 'Left -> Right should plan 15 + 10 + 3 = 28 ops');

  console.log('--- [UI E2E] 2. Clicking Filter Pills in UI ---');
  for (const [filterKey, expectedRows] of [
    ['only_left', 15],
    ['only_right', 12],
    ['newer_left', 10],
    ['newer_right', 8],
    ['identical', 10],
    ['differences', 48],
    ['all', 58],
  ]) {
    const rowCount = await wc.executeJavaScript(`
      document.querySelector('.filter-pill[data-filter="${filterKey}"]').click();
      document.querySelectorAll('#comparisonTableBody tr').length;
    `);
    assert.strictEqual(rowCount, expectedRows, `Filter "${filterKey}" should display ${expectedRows} rows`);
  }
  console.log('✅ All 7 UI filter pills clicked and verified!');

  console.log('--- [UI E2E] 3. Clicking Middle Direction Arrow & Direct Mode Buttons ---');
  // Click "Right -> Left" direct button
  const rlPlanned = await wc.executeJavaScript(`
    document.querySelector('.dir-mode-btn[data-dir="right_to_left"]').click();
    document.getElementById('plannedOpsCount').textContent;
  `);
  assert.strictEqual(rlPlanned, '23', 'Right -> Left should plan 12 + 8 + 3 = 23 ops');

  // Toggle Mirror Deletions checkbox on Right -> Left
  const rlMirrorPlanned = await wc.executeJavaScript(`
    document.getElementById('propagateDeletionsCheckbox').click();
    document.getElementById('plannedOpsCount').textContent;
  `);
  assert.strictEqual(rlMirrorPlanned, '38', 'Right -> Left + Mirror Deletions should plan 23 + 15 = 38 ops');

  // Uncheck Mirror Deletions and click Two-Way button
  const twoWayPlanned = await wc.executeJavaScript(`
    document.getElementById('propagateDeletionsCheckbox').click();
    document.querySelector('.dir-mode-btn[data-dir="two_way"]').click();
    document.getElementById('plannedOpsCount').textContent;
  `);
  assert.strictEqual(twoWayPlanned, '45', 'Two-Way should plan 25 (L->R) + 20 (R->L) = 45 ops');

  // Click middle #directionToggleBtn ("Change" arrow) to cycle Two-Way -> Left-to-Right
  const cycledDir = await wc.executeJavaScript(`
    document.getElementById('directionToggleBtn').click();
    getActiveJob().direction;
  `);
  assert.strictEqual(cycledDir, 'left_to_right', 'Clicking Change arrow after two_way should cycle to left_to_right');
  console.log('✅ Direction buttons, Change arrow, and Mirror toggle verified in UI!');

  console.log('--- [UI E2E] 4. Opening Confirm Sync Modal & Executing Sync via UI ---');
  const modalCounts = await wc.executeJavaScript(`
    document.getElementById('synchronizeBtn').click();
    ({
      open: document.getElementById('confirmSyncDialog').open,
      oneSide: document.getElementById('modalOneSideCount').textContent,
      bothNewer: document.getElementById('modalBothNewerCount').textContent,
    });
  `);
  assert.strictEqual(modalCounts.open, true, 'Confirmation dialog should open');
  assert.strictEqual(modalCounts.oneSide, '15', '15 one-side files planned for L->R');
  assert.strictEqual(modalCounts.bothNewer, '13', '10 newer_left + 3 conflict = 13 both-side files planned for L->R');

  // Click Execute Confirmed Sync button in the dialog
  await wc.executeJavaScript(`executeConfirmedSync()`);

  const postSyncCounts = await wc.executeJavaScript(`({
    onlyLeft: document.getElementById('countOnlyLeft').textContent,
    newerLeft: document.getElementById('countNewerLeft').textContent,
    identical: document.getElementById('countIdentical').textContent,
    planned: document.getElementById('plannedOpsCount').textContent,
  })`);
  console.log('UI Badge Counts after Executing L->R Sync:', postSyncCounts);
  assert.strictEqual(postSyncCounts.onlyLeft, '0');
  assert.strictEqual(postSyncCounts.newerLeft, '0');
  assert.strictEqual(postSyncCounts.identical, '38');
  assert.strictEqual(postSyncCounts.planned, '0');

  // Restore fresh F:\temp folders and re-run analysis so if the user opens the app, it's pre-loaded with all cases!
  await populateSmartFolders();
  await wc.executeJavaScript(`runAnalysis()`);

  console.log('✅ ALL UI E2E TESTS PASSED!');
  app.quit();
}

app.whenReady().then(() => {
  setTimeout(() => {
    runUITest().catch((err) => {
      console.error('❌ UI E2E Test failed:', err);
      app.exit(1);
    });
  }, 500);
});

