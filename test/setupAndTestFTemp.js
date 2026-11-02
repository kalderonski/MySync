const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { analyzeFolders, executeSync } = require('../src/syncEngine');

const LEFT_ROOT = 'F:\\temp\\SyncTest_Left';
const RIGHT_ROOT = 'F:\\temp\\SyncTest_Right';

const T_BASE = new Date('2026-06-15T10:00:00Z');
const T_OLDER = new Date('2026-06-10T08:30:00Z');
const T_NEWER_LEFT = new Date('2026-06-20T14:15:00Z');
const T_NEWER_RIGHT = new Date('2026-06-22T18:45:00Z');

async function writeWithTimestamp(baseDir, relPath, content, mtime) {
  const fullPath = path.join(baseDir, ...relPath.split('/'));
  await fsp.mkdir(path.dirname(fullPath), { recursive: true });
  await fsp.writeFile(fullPath, content, 'utf-8');
  await fsp.utimes(fullPath, mtime, mtime);
}

/**
 * Generates a realistic, deeply nested dataset in F:\temp\SyncTest_Left and F:\temp\SyncTest_Right
 * covering all 7 edge cases:
 *  - 15 files ONLY on Left (across nested subfolders)
 *  - 12 files ONLY on Right (across nested subfolders)
 *  - 10 files on BOTH sides, NEWER on Left
 *  - 8 files on BOTH sides, NEWER on Right
 *  - 10 files IDENTICAL on both sides
 *  - 3 files CONFLICT (same timestamp, different file sizes/contents)
 *  - 6 IGNORED files (.git, node_modules, *.tmp, Thumbs.db, .DS_Store)
 *
 * Total non-ignored unique relative paths = 15 + 12 + 10 + 8 + 10 + 3 = 58 files
 */
async function populateSmartFolders() {
  await fsp.rm(LEFT_ROOT, { recursive: true, force: true });
  await fsp.rm(RIGHT_ROOT, { recursive: true, force: true });
  await fsp.mkdir(LEFT_ROOT, { recursive: true });
  await fsp.mkdir(RIGHT_ROOT, { recursive: true });

  // 1. 15 Files ONLY on Left (deep subfolder hierarchy)
  const onlyLeftFiles = [
    '01_Only_Left/Finance/2026/Q1/budget_q1.csv',
    '01_Only_Left/Finance/2026/Q1/invoices_jan.pdf',
    '01_Only_Left/Finance/2026/Q2/budget_q2.csv',
    '01_Only_Left/Finance/2026/Q2/tax_projection.xlsx',
    '01_Only_Left/Engineering/Architecture/system_design_v1.md',
    '01_Only_Left/Engineering/Architecture/Diagrams/network_topology.svg',
    '01_Only_Left/Engineering/Scripts/deploy_prod.ps1',
    '01_Only_Left/Engineering/Scripts/Utils/backup_db.sh',
    '01_Only_Left/Media/Photos/2026_Retreat/team_photo_01.jpg',
    '01_Only_Left/Media/Photos/2026_Retreat/team_photo_02.jpg',
    '01_Only_Left/Media/Audio/keynote_intro.wav',
    '01_Only_Left/Legal/Contracts/NDA_Vendor_A.docx',
    '01_Only_Left/Legal/Contracts/Subprocessors/cloud_terms.txt',
    '01_Only_Left/Notes/Deep/Level1/Level2/Level3/deep_left_note.txt',
    '01_Only_Left/README_LEFT_EXCLUSIVE.md',
  ];
  for (let i = 0; i < onlyLeftFiles.length; i++) {
    await writeWithTimestamp(
      LEFT_ROOT,
      onlyLeftFiles[i],
      `[ONLY_LEFT #${i + 1}] Exclusive content from Left folder (${onlyLeftFiles[i]})\n`,
      T_NEWER_LEFT
    );
  }

  // 2. 12 Files ONLY on Right (deep subfolder hierarchy)
  const onlyRightFiles = [
    '02_Only_Right/Backups/2025_Archive/legacy_ledger.csv',
    '02_Only_Right/Backups/2025_Archive/Dec/closing_summary.txt',
    '02_Only_Right/Backups/DatabaseSnapshots/snap_2026_05.sql',
    '02_Only_Right/Marketing/Campaigns/Summer2026/ad_copy_v1.md',
    '02_Only_Right/Marketing/Campaigns/Summer2026/Assets/banner_1920x1080.png',
    '02_Only_Right/Marketing/Brand/logo_guidelines.pdf',
    '02_Only_Right/HR/Onboarding/welcome_handbook.docx',
    '02_Only_Right/HR/Policies/remote_work_policy.md',
    '02_Only_Right/Operations/Inventory/warehouse_east.json',
    '02_Only_Right/Operations/Inventory/warehouse_west.json',
    '02_Only_Right/Notes/Deep/Level1/Level2/Level3/deep_right_note.txt',
    '02_Only_Right/README_RIGHT_EXCLUSIVE.md',
  ];
  for (let i = 0; i < onlyRightFiles.length; i++) {
    await writeWithTimestamp(
      RIGHT_ROOT,
      onlyRightFiles[i],
      `[ONLY_RIGHT #${i + 1}] Exclusive content from Right folder (${onlyRightFiles[i]})\n`,
      T_NEWER_RIGHT
    );
  }

  // 3. 10 Files on BOTH sides, NEWER on Left
  const newerLeftFiles = [
    '03_Shared_Projects/WebApp/src/index.js',
    '03_Shared_Projects/WebApp/src/components/Header.js',
    '03_Shared_Projects/WebApp/src/components/Sidebar.js',
    '03_Shared_Projects/WebApp/config/settings.json',
    '03_Shared_Projects/Docs/Specifications/api_spec_v2.yaml',
    '03_Shared_Projects/Docs/Specifications/auth_flow.md',
    '03_Shared_Projects/Docs/ReleaseNotes/changelog_2026.md',
    '03_Shared_Projects/Data/Analytics/monthly_kpis.csv',
    '03_Shared_Projects/Data/Models/forecast_weights.bin',
    '03_Shared_Projects/roadmap_master.txt',
  ];
  for (let i = 0; i < newerLeftFiles.length; i++) {
    await writeWithTimestamp(
      LEFT_ROOT,
      newerLeftFiles[i],
      `[NEWER_ON_LEFT #${i + 1}] Freshly updated on Left at ${T_NEWER_LEFT.toISOString()} — Extra lines added.\n`,
      T_NEWER_LEFT
    );
    await writeWithTimestamp(
      RIGHT_ROOT,
      newerLeftFiles[i],
      `[OLDER_ON_RIGHT #${i + 1}] Outdated version on Right.\n`,
      T_OLDER
    );
  }

  // 4. 8 Files on BOTH sides, NEWER on Right
  const newerRightFiles = [
    '03_Shared_Projects/MobileApp/ios/Info.plist',
    '03_Shared_Projects/MobileApp/android/build.gradle',
    '03_Shared_Projects/MobileApp/shared/theme.json',
    '03_Shared_Projects/Docs/Runbooks/incident_response.md',
    '03_Shared_Projects/Docs/Runbooks/disaster_recovery.md',
    '03_Shared_Projects/Data/CustomerReports/feedback_q2.csv',
    '03_Shared_Projects/Data/CustomerReports/nps_survey.json',
    '03_Shared_Projects/team_roster.txt',
  ];
  for (let i = 0; i < newerRightFiles.length; i++) {
    await writeWithTimestamp(
      LEFT_ROOT,
      newerRightFiles[i],
      `[OLDER_ON_LEFT #${i + 1}] Outdated version on Left.\n`,
      T_OLDER
    );
    await writeWithTimestamp(
      RIGHT_ROOT,
      newerRightFiles[i],
      `[NEWER_ON_RIGHT #${i + 1}] Freshly updated on Right at ${T_NEWER_RIGHT.toISOString()} — Contains latest edits.\n`,
      T_NEWER_RIGHT
    );
  }

  // 5. 10 Files IDENTICAL on both sides (same timestamp & byte size)
  const identicalFiles = [
    '04_Identical_Common/Certificates/root_ca.pem',
    '04_Identical_Common/Certificates/intermediate_ca.pem',
    '04_Identical_Common/Templates/invoice_template.html',
    '04_Identical_Common/Templates/email_footer.html',
    '04_Identical_Common/Fonts/Inter-Regular.ttf',
    '04_Identical_Common/Fonts/Inter-Bold.ttf',
    '04_Identical_Common/Schemas/user_schema.json',
    '04_Identical_Common/Schemas/order_schema.json',
    '04_Identical_Common/LICENSE.txt',
    '04_Identical_Common/CONTRIBUTING.md',
  ];
  for (let i = 0; i < identicalFiles.length; i++) {
    const body = `[IDENTICAL #${i + 1}] Exact same content and timestamp on both Left and Right.\n`;
    await writeWithTimestamp(LEFT_ROOT, identicalFiles[i], body, T_BASE);
    await writeWithTimestamp(RIGHT_ROOT, identicalFiles[i], body, T_BASE);
  }

  // 6. 3 Files CONFLICT (identical timestamp within 2s tolerance, different byte size)
  const conflictFiles = [
    '05_Conflicts/Config/environment.env',
    '05_Conflicts/Config/feature_flags.json',
    '05_Conflicts/Database/migration_lock.txt',
  ];
  for (let i = 0; i < conflictFiles.length; i++) {
    await writeWithTimestamp(
      LEFT_ROOT,
      conflictFiles[i],
      `[CONFLICT_LEFT #${i + 1}] Left side modified with LONG payload (${conflictFiles[i]}) — 1234567890\n`,
      T_BASE
    );
    await writeWithTimestamp(
      RIGHT_ROOT,
      conflictFiles[i],
      `[CONFLICT_RIGHT #${i + 1}] Short payload\n`,
      T_BASE
    );
  }

  // 7. 6 Excluded / Ignored files (.git, node_modules, *.tmp, Thumbs.db, .DS_Store)
  await writeWithTimestamp(LEFT_ROOT, '.git/HEAD', 'ref: refs/heads/main\n', T_BASE);
  await writeWithTimestamp(LEFT_ROOT, '.git/config', '[core]\nrepositoryformatversion = 0\n', T_BASE);
  await writeWithTimestamp(LEFT_ROOT, 'node_modules/lodash/index.js', 'module.exports = {};\n', T_BASE);
  await writeWithTimestamp(LEFT_ROOT, '03_Shared_Projects/WebApp/build_cache.tmp', 'temp build cache\n', T_BASE);
  await writeWithTimestamp(RIGHT_ROOT, '02_Only_Right/Marketing/Thumbs.db', 'windows thumb cache\n', T_BASE);
  await writeWithTimestamp(RIGHT_ROOT, '02_Only_Right/.DS_Store', 'macos metadata\n', T_BASE);
}

async function runComprehensiveScenarios() {
  console.log('================================================================');
  console.log('1. POPULATING F:\\temp\\SyncTest_Left AND F:\\temp\\SyncTest_Right');
  console.log('================================================================');
  await populateSmartFolders();

  // Baseline analysis check
  const baseAnalysis = await analyzeFolders({
    leftDir: LEFT_ROOT,
    rightDir: RIGHT_ROOT,
    direction: 'left_to_right',
    propagateDeletions: false,
  });

  console.log('Initial Analysis Counts:', baseAnalysis.counts);
  assert.strictEqual(baseAnalysis.counts.total, 58, 'Total non-ignored files must be 58');
  assert.strictEqual(baseAnalysis.counts.only_left, 15, 'Only on Left must be 15');
  assert.strictEqual(baseAnalysis.counts.only_right, 12, 'Only on Right must be 12');
  assert.strictEqual(baseAnalysis.counts.newer_left, 10, 'Newer on Left must be 10');
  assert.strictEqual(baseAnalysis.counts.newer_right, 8, 'Newer on Right must be 8');
  assert.strictEqual(baseAnalysis.counts.identical, 10, 'Identical must be 10');
  assert.strictEqual(baseAnalysis.counts.conflict, 3, 'Conflict must be 3');

  // ---------------------------------------------------------------------------
  // SCENARIO A: Left -> Right (One-Way, No Mirror Deletions)
  // Expected:
  //   - 15 only_left + 10 newer_left + 3 conflict = 28 files copied Left -> Right
  //   - 12 only_right files preserved on Right (skipped)
  //   - 8 newer_right files preserved on Right (skipped)
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('2. TESTING SCENARIO A: Left -> Right (One-Way, No Deletions)');
  console.log('================================================================');
  const execA = await executeSync({
    leftDir: LEFT_ROOT,
    rightDir: RIGHT_ROOT,
    operations: baseAnalysis.items,
  });
  console.log(`Scenario A Result: Copied L->R: ${execA.copiedToRight}, Deleted R: ${execA.deletedRight}, Errors: ${execA.errors.length}`);
  assert.strictEqual(execA.copiedToRight, 28, 'Should copy 28 files Left -> Right');
  assert.strictEqual(execA.deletedRight, 0, 'Should delete 0 files on Right');
  assert.strictEqual(execA.errors.length, 0);

  const postA = await analyzeFolders({
    leftDir: LEFT_ROOT,
    rightDir: RIGHT_ROOT,
    direction: 'left_to_right',
    propagateDeletions: false,
  });
  console.log('Post-Scenario A Counts:', postA.counts);
  assert.strictEqual(postA.counts.only_left, 0, 'After L->R, 0 files should be only on Left');
  assert.strictEqual(postA.counts.newer_left, 0, 'After L->R, 0 files should be newer on Left');
  assert.strictEqual(postA.counts.conflict, 0, 'After L->R, conflicts resolved in favor of Left');
  assert.strictEqual(postA.counts.only_right, 12, '12 files only on Right remain untouched');
  assert.strictEqual(postA.counts.newer_right, 8, '8 files newer on Right remain untouched');
  assert.strictEqual(postA.counts.identical, 38, '10 + 28 = 38 files are now identical');

  // ---------------------------------------------------------------------------
  // SCENARIO B: Left -> Right (One-Way WITH Mirror Deletions enabled)
  // Expected:
  //   - The 12 only_right files are deleted from Right
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('3. TESTING SCENARIO B: Left -> Right (One-Way WITH Mirror Deletions)');
  console.log('================================================================');
  await populateSmartFolders();
  const analysisB = await analyzeFolders({
    leftDir: LEFT_ROOT,
    rightDir: RIGHT_ROOT,
    direction: 'left_to_right',
    propagateDeletions: true,
  });
  const execB = await executeSync({
    leftDir: LEFT_ROOT,
    rightDir: RIGHT_ROOT,
    operations: analysisB.items,
  });
  console.log(`Scenario B Result: Copied L->R: ${execB.copiedToRight}, Deleted R: ${execB.deletedRight}, Errors: ${execB.errors.length}`);
  assert.strictEqual(execB.copiedToRight, 28);
  assert.strictEqual(execB.deletedRight, 12, 'Should delete 12 extra files on Right');
  assert.strictEqual(execB.errors.length, 0);

  const postB = await analyzeFolders({
    leftDir: LEFT_ROOT,
    rightDir: RIGHT_ROOT,
    direction: 'left_to_right',
    propagateDeletions: true,
  });
  console.log('Post-Scenario B Counts:', postB.counts);
  assert.strictEqual(postB.counts.only_right, 0, 'All extra Right files deleted');
  assert.strictEqual(postB.counts.only_left, 0);

  // ---------------------------------------------------------------------------
  // SCENARIO C: Right -> Left (One-Way, No Mirror Deletions)
  // Expected:
  //   - 12 only_right + 8 newer_right + 3 conflict = 23 files copied Right -> Left
  //   - 15 only_left files preserved on Left
  //   - 10 newer_left files preserved on Left
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('4. TESTING SCENARIO C: Right -> Left (One-Way, No Deletions)');
  console.log('================================================================');
  await populateSmartFolders();
  const analysisC = await analyzeFolders({
    leftDir: LEFT_ROOT,
    rightDir: RIGHT_ROOT,
    direction: 'right_to_left',
    propagateDeletions: false,
  });
  const execC = await executeSync({
    leftDir: LEFT_ROOT,
    rightDir: RIGHT_ROOT,
    operations: analysisC.items,
  });
  console.log(`Scenario C Result: Copied R->L: ${execC.copiedToLeft}, Deleted L: ${execC.deletedLeft}, Errors: ${execC.errors.length}`);
  assert.strictEqual(execC.copiedToLeft, 23, 'Should copy 23 files Right -> Left');
  assert.strictEqual(execC.deletedLeft, 0);
  assert.strictEqual(execC.errors.length, 0);

  const postC = await analyzeFolders({
    leftDir: LEFT_ROOT,
    rightDir: RIGHT_ROOT,
    direction: 'right_to_left',
    propagateDeletions: false,
  });
  console.log('Post-Scenario C Counts:', postC.counts);
  assert.strictEqual(postC.counts.only_right, 0);
  assert.strictEqual(postC.counts.newer_right, 0);
  assert.strictEqual(postC.counts.only_left, 15);
  assert.strictEqual(postC.counts.newer_left, 10);
  assert.strictEqual(postC.counts.identical, 33, '10 + 23 = 33 files identical');

  // ---------------------------------------------------------------------------
  // SCENARIO D: Right -> Left (One-Way WITH Mirror Deletions)
  // Expected:
  //   - 23 files copied Right -> Left
  //   - 15 only_left files deleted from Left
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('5. TESTING SCENARIO D: Right -> Left (One-Way WITH Mirror Deletions)');
  console.log('================================================================');
  await populateSmartFolders();
  const analysisD = await analyzeFolders({
    leftDir: LEFT_ROOT,
    rightDir: RIGHT_ROOT,
    direction: 'right_to_left',
    propagateDeletions: true,
  });
  const execD = await executeSync({
    leftDir: LEFT_ROOT,
    rightDir: RIGHT_ROOT,
    operations: analysisD.items,
  });
  console.log(`Scenario D Result: Copied R->L: ${execD.copiedToLeft}, Deleted L: ${execD.deletedLeft}, Errors: ${execD.errors.length}`);
  assert.strictEqual(execD.copiedToLeft, 23);
  assert.strictEqual(execD.deletedLeft, 15, 'Should delete 15 extra files on Left');
  assert.strictEqual(execD.errors.length, 0);

  // ---------------------------------------------------------------------------
  // SCENARIO E: Two-Way Sync (Left ⇄ Right)
  // Expected:
  //   - 15 only_left + 10 newer_left = 25 files copied Left -> Right
  //   - 12 only_right + 8 newer_right = 20 files copied Right -> Left
  //   - 3 conflict files skipped by default so user can decide
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('6. TESTING SCENARIO E: Two-Way Bidirectional Sync (Left ⇄ Right)');
  console.log('================================================================');
  await populateSmartFolders();
  const analysisE = await analyzeFolders({
    leftDir: LEFT_ROOT,
    rightDir: RIGHT_ROOT,
    direction: 'two_way',
    propagateDeletions: false,
  });
  const execE = await executeSync({
    leftDir: LEFT_ROOT,
    rightDir: RIGHT_ROOT,
    operations: analysisE.items,
  });
  console.log(`Scenario E Result: Copied L->R: ${execE.copiedToRight}, Copied R->L: ${execE.copiedToLeft}, Errors: ${execE.errors.length}`);
  assert.strictEqual(execE.copiedToRight, 25, 'Should copy 25 files Left -> Right');
  assert.strictEqual(execE.copiedToLeft, 20, 'Should copy 20 files Right -> Left');
  assert.strictEqual(execE.errors.length, 0);

  const postE = await analyzeFolders({
    leftDir: LEFT_ROOT,
    rightDir: RIGHT_ROOT,
    direction: 'two_way',
    propagateDeletions: false,
  });
  console.log('Post-Scenario E Counts:', postE.counts);
  assert.strictEqual(postE.counts.only_left, 0);
  assert.strictEqual(postE.counts.only_right, 0);
  assert.strictEqual(postE.counts.newer_left, 0);
  assert.strictEqual(postE.counts.newer_right, 0);
  assert.strictEqual(postE.counts.identical, 55, '55 of 58 files are now identical');
  assert.strictEqual(postE.counts.conflict, 3, '3 conflicts remain untouched until manually overridden');

  // ---------------------------------------------------------------------------
  // SCENARIO F: Individual Per-File Manual Action Overrides & Unchecking
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('7. TESTING SCENARIO F: Per-File Action Override & Checkbox Deselection');
  console.log('================================================================');
  // Override the 3 remaining conflicts: 2 to copy_to_right, 1 to copy_to_left
  const conflictItems = postE.items.filter((i) => i.status === 'conflict');
  conflictItems[0].action = 'copy_to_right';
  conflictItems[0].checked = true;
  conflictItems[1].action = 'copy_to_left';
  conflictItems[1].checked = true;
  conflictItems[2].action = 'copy_to_right';
  conflictItems[2].checked = false; // unchecked -> should NOT execute

  const execF = await executeSync({
    leftDir: LEFT_ROOT,
    rightDir: RIGHT_ROOT,
    operations: postE.items,
  });
  console.log(`Scenario F Result: Copied L->R: ${execF.copiedToRight}, Copied R->L: ${execF.copiedToLeft}`);
  assert.strictEqual(execF.copiedToRight, 1, 'Only checked copy_to_right conflict should run');
  assert.strictEqual(execF.copiedToLeft, 1, 'Checked copy_to_left conflict should run');

  // ---------------------------------------------------------------------------
  // FINAL STEP: Re-populate F:\temp\SyncTest_Left and F:\temp\SyncTest_Right
  // in their fresh, multi-case state so the user can also inspect & play with
  // them directly inside the live Electron GUI!
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('8. RESTORING FRESH SMART TEST FOLDERS IN F:\\temp FOR INTERACTIVE UI USE');
  console.log('================================================================');
  await populateSmartFolders();
  console.log('✅ All 6 Sync Scenarios verified & F:\\temp\\SyncTest_Left + F:\\temp\\SyncTest_Right ready!');
}

if (require.main === module) {
  runComprehensiveScenarios().catch((err) => {
    console.error('❌ Verification failed:', err);
    process.exit(1);
  });
}

module.exports = { populateSmartFolders, LEFT_ROOT, RIGHT_ROOT };

