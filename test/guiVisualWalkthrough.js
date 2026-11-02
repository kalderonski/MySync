const assert = require('assert');
const { app, BrowserWindow } = require('electron');
const fsp = require('fs/promises');
const path = require('path');
const { populateSmartFolders, LEFT_ROOT, RIGHT_ROOT } = require('./setupAndTestFTemp');

// Ensure we run inside Electron GUI process (not ELECTRON_RUN_AS_NODE)
if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE) {
  const { spawn } = require('child_process');
  const electronPath = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, [__filename], { env, stdio: 'inherit', windowsHide: false });
  child.on('exit', (code) => process.exit(code ?? 0));
  return;
}

const ARTIFACT_DIR =
  'C:\\Users\\kalderonski\\.gemini\\antigravity\\brain\\7aeacca0-112d-4765-8182-539c232d2f50';

require('../src/main');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function captureWindow(win, filename) {
  await sleep(350);
  const image = await win.webContents.capturePage();
  const outPath = path.join(ARTIFACT_DIR, filename);
  await fsp.writeFile(outPath, image.toPNG());
  console.log(`📸 Captured GUI screenshot: ${filename}`);
  return outPath;
}

async function runFullGUIWalkthrough() {
  await populateSmartFolders();
  await sleep(1200);

  const win = BrowserWindow.getAllWindows()[0];
  assert(win, 'Main BrowserWindow should exist');
  win.setSize(1280, 860);
  win.center();
  win.show();
  win.focus();

  const wc = win.webContents;

  // ---------------------------------------------------------------------------
  // STEP 1: Create/Configure Job Profile & Run "Analyze" in Left -> Right Mode
  // ---------------------------------------------------------------------------
  console.log('\n[GUI TEST 1] Setting F:\\temp\\SyncTest_Left & Right and clicking Analyze (Left -> Right)...');
  await wc.executeJavaScript(`
    (async () => {
      document.querySelector('meta[name="color-scheme"]').content = 'dark';
      const job = getActiveJob();
      job.name = 'F:\\\\temp Smart Test Suite';
      job.leftDir = ${JSON.stringify(LEFT_ROOT)};
      job.rightDir = ${JSON.stringify(RIGHT_ROOT)};
      job.direction = 'left_to_right';
      job.propagateDeletions = false;
      renderJobSelectorAndTabs();
      renderActiveJobControls();
      document.getElementById('analyzeBtn').click();
    })();
  `);
  await sleep(900);
  await captureWindow(win, 'gui_01_analyze_left_to_right.png');

  // Verify badge counts
  const badges = await wc.executeJavaScript(`({
    all: document.getElementById('countAll').textContent,
    diffs: document.getElementById('countDifferences').textContent,
    onlyLeft: document.getElementById('countOnlyLeft').textContent,
    onlyRight: document.getElementById('countOnlyRight').textContent,
    newerLeft: document.getElementById('countNewerLeft').textContent,
    newerRight: document.getElementById('countNewerRight').textContent,
    identical: document.getElementById('countIdentical').textContent,
    planned: document.getElementById('plannedOpsCount').textContent,
  })`);
  console.log('Verified GUI Badges:', badges);
  assert.strictEqual(badges.all, '58');
  assert.strictEqual(badges.onlyLeft, '15');
  assert.strictEqual(badges.onlyRight, '12');
  assert.strictEqual(badges.newerLeft, '10');
  assert.strictEqual(badges.newerRight, '8');
  assert.strictEqual(badges.identical, '10');
  assert.strictEqual(badges.planned, '28');

  // ---------------------------------------------------------------------------
  // STEP 2: Test All Filter Pills & Search Box in the GUI
  // ---------------------------------------------------------------------------
  console.log('\n[GUI TEST 2] Clicking through Filter Pills (Only on Left, Both: Newer on Left, Both: Newer on Right)...');
  await wc.executeJavaScript(`document.querySelector('.filter-pill[data-filter="only_left"]').click();`);
  await captureWindow(win, 'gui_02_filter_only_left.png');

  await wc.executeJavaScript(`document.querySelector('.filter-pill[data-filter="newer_left"]').click();`);
  await captureWindow(win, 'gui_03_filter_newer_left.png');

  // Test Right-Click Context Menu & Side-by-Side File Preview Diff!
  console.log('\n[GUI TEST 2B] Right-clicking a file row to open Context Menu & Side-by-Side Preview Diff...');
  await wc.executeJavaScript(`
    (() => {
      const firstRow = document.querySelector('#comparisonTableBody tr');
      firstRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 310 }));
    })();
  `);
  await captureWindow(win, 'gui_11_right_click_context_menu.png');

  await wc.executeJavaScript(`
    document.getElementById('ctxPreviewDiff').click();
  `);
  await sleep(400);
  await captureWindow(win, 'gui_12_file_preview_diff_modal.png');
  await wc.executeJavaScript(`document.getElementById('closeFilePreviewBtn').click();`);

  await wc.executeJavaScript(`
    document.querySelector('meta[name="color-scheme"]').content = 'light';
    document.querySelector('.filter-pill[data-filter="newer_right"]').click();
  `);
  await captureWindow(win, 'gui_04_filter_newer_right.png');
  await wc.executeJavaScript(`document.querySelector('meta[name="color-scheme"]').content = 'dark';`);

  // Test Search Input
  console.log('\n[GUI TEST 3] Testing Search Filter ("roadmap_master")...');
  await wc.executeJavaScript(`
    (() => {
      document.querySelector('.filter-pill[data-filter="all"]').click();
      const s = document.getElementById('searchFilterInput');
      s.value = 'roadmap_master';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    })();
  `);
  const searchRows = await wc.executeJavaScript(`document.querySelectorAll('#comparisonTableBody tr').length`);
  assert.strictEqual(searchRows, 1, 'Search for "roadmap_master" should show 1 row');

  // Clear search
  await wc.executeJavaScript(`
    (() => {
      const s = document.getElementById('searchFilterInput');
      s.value = '';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    })();
  `);

  // ---------------------------------------------------------------------------
  // STEP 3: Test Direction Controls (Change Arrow, Left<-Right, Two-Way) & Mirror Checkbox
  // ---------------------------------------------------------------------------
  console.log('\n[GUI TEST 4] Clicking "Left <- Right" Direction Button & "Delete extra files on target (Mirror)"...');
  await wc.executeJavaScript(`
    document.querySelector('.dir-mode-btn[data-dir="right_to_left"]').click();
    document.getElementById('propagateDeletionsCheckbox').click();
  `);
  await captureWindow(win, 'gui_05_right_to_left_mirror.png');
  const rlMirrorPlanned = await wc.executeJavaScript(`document.getElementById('plannedOpsCount').textContent`);
  assert.strictEqual(rlMirrorPlanned, '38', 'Right -> Left with Mirror should plan 38 operations');

  console.log('\n[GUI TEST 5] Clicking "Two-Way" Direction Button & Individual Per-Row Action Dropdown...');
  await wc.executeJavaScript(`
    document.getElementById('propagateDeletionsCheckbox').click(); // turn mirror off
    document.querySelector('.dir-mode-btn[data-dir="two_way"]').click();
  `);
  await captureWindow(win, 'gui_06_two_way_mode.png');

  // ---------------------------------------------------------------------------
  // STEP 4: Test Settings Dialog & Exclusion Rules via GUI
  // ---------------------------------------------------------------------------
  console.log('\n[GUI TEST 6] Opening ⚙️ Settings Dialog via GUI...');
  await wc.executeJavaScript(`document.getElementById('openSettingsBtn').click();`);
  await captureWindow(win, 'gui_07_settings_dialog.png');
  await wc.executeJavaScript(`document.getElementById('closeSettingsBtn').click();`);

  // ---------------------------------------------------------------------------
  // STEP 5: Switch to Left -> Right, Open Pre-Execution Confirmation Modal, and Execute Sync!
  // ---------------------------------------------------------------------------
  console.log('\n[GUI TEST 7] Switching to Left -> Right, clicking "Synchronize (28)" to open Confirmation Modal...');
  await wc.executeJavaScript(`
    document.querySelector('.dir-mode-btn[data-dir="left_to_right"]').click();
    document.getElementById('synchronizeBtn').click();
  `);
  await captureWindow(win, 'gui_08_confirm_sync_modal.png');

  console.log('\n[GUI TEST 8] Clicking "Execute Synchronization Now" in the Confirmation Modal...');
  await wc.executeJavaScript(`document.getElementById('executeConfirmedSyncBtn').click();`);
  await sleep(1000);
  await captureWindow(win, 'gui_09_post_sync_activity_log.png');

  const postLeftToRight = await wc.executeJavaScript(`({
    onlyLeft: document.getElementById('countOnlyLeft').textContent,
    newerLeft: document.getElementById('countNewerLeft').textContent,
    identical: document.getElementById('countIdentical').textContent,
    planned: document.getElementById('plannedOpsCount').textContent,
  })`);
  console.log('Post Left->Right Execution Counts:', postLeftToRight);
  assert.strictEqual(postLeftToRight.onlyLeft, '0');
  assert.strictEqual(postLeftToRight.newerLeft, '0');
  assert.strictEqual(postLeftToRight.identical, '38');
  assert.strictEqual(postLeftToRight.planned, '0');

  // ---------------------------------------------------------------------------
  // STEP 6: Now Switch to Right -> Left in the GUI and Sync the Remaining 20 Right-side Files!
  // ---------------------------------------------------------------------------
  console.log('\n[GUI TEST 9] Switching to Right -> Left in GUI and executing sync so both folders become 100% identical...');
  await wc.executeJavaScript(`
    document.querySelector('.dir-mode-btn[data-dir="right_to_left"]').click();
    document.getElementById('synchronizeBtn').click();
    document.getElementById('executeConfirmedSyncBtn').click();
  `);
  await sleep(1000);
  await captureWindow(win, 'gui_10_fully_synchronized_58_identical.png');

  const finalCounts = await wc.executeJavaScript(`({
    all: document.getElementById('countAll').textContent,
    diffs: document.getElementById('countDifferences').textContent,
    identical: document.getElementById('countIdentical').textContent,
  })`);
  console.log('Final Counts after syncing both directions:', finalCounts);
  assert.strictEqual(finalCounts.all, '58');
  assert.strictEqual(finalCounts.diffs, '0');
  assert.strictEqual(finalCounts.identical, '58');

  // ---------------------------------------------------------------------------
  // STEP 7: Restore fresh F:\temp dataset and re-analyze so user has the live state ready
  // ---------------------------------------------------------------------------
  console.log('\n[GUI TEST 10] Restoring fresh 58-file multi-case dataset in F:\\temp for user...');
  await populateSmartFolders();
  await wc.executeJavaScript(`
    document.querySelector('.dir-mode-btn[data-dir="left_to_right"]').click();
    document.querySelector('.log-tab[data-logtab="presync"]').click();
    document.getElementById('analyzeBtn').click();
  `);
  await sleep(800);

  console.log('✅ ALL 10 GUI WALKTHROUGH STEPS COMPLETED & SCREENSHOTS CAPTURED!');
  app.quit();
}

app.whenReady().then(() => {
  setTimeout(() => {
    runFullGUIWalkthrough().catch((err) => {
      console.error('❌ GUI Walkthrough failed:', err);
      app.exit(1);
    });
  }, 500);
});
