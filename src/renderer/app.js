/* global mysyncAPI */

const PAGE_SIZE = 250;
const REPORT_LIST_CAP = 500;

const state = {
  activeJobId: 'job-1',
  jobs: [],
  analysisByJobId: {}, // jobId -> analysisResult
  activeFilter: 'all',
  searchQuery: '',
  currentPage: 1,
  contextItem: null,
  pendingTrashAction: null,
};

const DIRECTION_CYCLE = ['left_to_right', 'right_to_left', 'two_way'];

const DIRECTION_META = {
  left_to_right: {
    label: 'Left ➔ Right (One-Way)',
    points: '12,16 134,16 134,5 172,24 134,43 134,32 12,32',
  },
  right_to_left: {
    label: 'Right ➔ Left (One-Way)',
    points: '168,16 46,16 46,5 8,24 46,43 46,32 168,32',
  },
  two_way: {
    label: 'Left ⇄ Right (Two-Way)',
    points: '8,24 42,5 42,16 138,16 138,5 172,24 138,43 138,32 42,32 42,43',
  },
};

const STATUS_LABELS = {
  only_left: 'Only in Left Folder',
  only_right: 'Only in Right Folder',
  newer_left: 'Both Sides (Newer on Left)',
  newer_right: 'Both Sides (Newer on Right)',
  identical: 'Identical on Both Sides',
  conflict: 'Same Time / Different Size',
};

const ACTION_LABELS = {
  copy_to_right: 'Copy Left ➔ Right',
  copy_to_left: 'Copy Right ➔ Left',
  delete_right: 'Delete on Right',
  delete_left: 'Delete on Left',
  skip: 'Do Nothing (Skip)',
};

function getActiveJob() {
  return state.jobs.find((j) => j.id === state.activeJobId) || state.jobs[0];
}

function getActiveAnalysis() {
  return state.analysisByJobId[state.activeJobId] || null;
}

function formatBytes(bytes) {
  if (bytes == null) return '';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDurationDiff(diffMs) {
  const absSec = Math.round(Math.abs(diffMs) / 1000);
  if (absSec < 60) return `${absSec}s`;
  const mins = Math.floor(absSec / 60);
  if (mins < 60) return `${mins}m ${absSec % 60}s`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function appendLog(level, message) {
  const stream = document.getElementById('activityLogStream');
  const entry = document.createElement('div');
  entry.className = `log-entry level-${level}`;

  const nowStr = new Date().toLocaleString();
  const icons = {
    info: 'ℹ️',
    success: '✅',
    warn: '⚠️',
    error: '❌',
  };

  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = `[${nowStr}] ${icons[level] || 'ℹ️'}`;

  const msgSpan = document.createElement('span');
  msgSpan.textContent = message;

  entry.appendChild(timeSpan);
  entry.appendChild(msgSpan);
  stream.appendChild(entry);
  stream.parentElement.scrollTop = stream.parentElement.scrollHeight;
}

function computeDefaultActionForRow(status, direction, propagateDeletions) {
  if (status === 'identical') return 'skip';
  if (direction === 'left_to_right') {
    if (status === 'only_left' || status === 'newer_left' || status === 'conflict') return 'copy_to_right';
    if (status === 'only_right') return propagateDeletions ? 'delete_right' : 'skip';
    return 'skip';
  }
  if (direction === 'right_to_left') {
    if (status === 'only_right' || status === 'newer_right' || status === 'conflict') return 'copy_to_left';
    if (status === 'only_left') return propagateDeletions ? 'delete_left' : 'skip';
    return 'skip';
  }
  // two_way
  if (status === 'only_left' || status === 'newer_left') return 'copy_to_right';
  if (status === 'only_right' || status === 'newer_right') return 'copy_to_left';
  return 'skip';
}

function recalculateActionsForCurrentJob() {
  const job = getActiveJob();
  const analysis = getActiveAnalysis();
  if (!job || !analysis) return;

  analysis.direction = job.direction;
  analysis.propagateDeletions = job.propagateDeletions;

  for (const item of analysis.items) {
    const nextAction = computeDefaultActionForRow(
      item.status,
      job.direction,
      job.propagateDeletions
    );
    item.action = nextAction;
    item.checked = nextAction !== 'skip';
  }
}

async function persistProfiles() {
  await mysyncAPI.saveProfiles({
    activeJobId: state.activeJobId,
    jobs: state.jobs,
  });
}

function renderJobSelectorAndTabs() {
  const tabsContainer = document.getElementById('jobTabsContainer');
  const selectDropdown = document.getElementById('jobSelectDropdown');
  tabsContainer.innerHTML = '';
  selectDropdown.innerHTML = '';

  for (const job of state.jobs) {
    const tabBtn = document.createElement('button');
    tabBtn.type = 'button';
    tabBtn.role = 'tab';
    tabBtn.className = `job-tab ${job.id === state.activeJobId ? 'active' : ''}`;
    tabBtn.setAttribute('aria-selected', job.id === state.activeJobId ? 'true' : 'false');
    tabBtn.textContent = `🗄️ ${job.name}`;
    tabBtn.addEventListener('click', () => switchJob(job.id));
    tabsContainer.appendChild(tabBtn);

    const opt = document.createElement('option');
    opt.value = job.id;
    opt.textContent = job.name;
    opt.selected = job.id === state.activeJobId;
    selectDropdown.appendChild(opt);
  }
}

function renderActiveJobControls() {
  const job = getActiveJob();
  if (!job) return;

  document.getElementById('leftDirInput').value = job.leftDir || '';
  document.getElementById('rightDirInput').value = job.rightDir || '';
  document.getElementById('propagateDeletionsCheckbox').checked = Boolean(job.propagateDeletions);
  const skipHiddenEl = document.getElementById('skipHiddenSystemCheckbox');
  if (skipHiddenEl) skipHiddenEl.checked = Boolean(job.skipHiddenSystem);

  const dirMeta = DIRECTION_META[job.direction] || DIRECTION_META.left_to_right;
  document.getElementById('arrowPolygon').setAttribute('points', dirMeta.points);

  document.querySelectorAll('.dir-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.dir === job.direction);
  });
}

function setDirection(nextDirection) {
  const job = getActiveJob();
  if (!job || !DIRECTION_META[nextDirection]) return;
  job.direction = nextDirection;
  renderActiveJobControls();
  recalculateActionsForCurrentJob();
  renderComparisonTable();
  persistProfiles();
  appendLog('info', `Sync direction set to: ${DIRECTION_META[job.direction].label}`);
}

function getFilteredItems() {
  const analysis = getActiveAnalysis();
  if (!analysis) return [];

  const q = state.searchQuery.trim().toLowerCase();
  return analysis.items.filter((item) => {
    if (state.activeFilter === 'differences' && item.status === 'identical') return false;
    if (
      state.activeFilter !== 'all' &&
      state.activeFilter !== 'differences' &&
      item.status !== state.activeFilter
    ) {
      return false;
    }
    if (q && !item.relPath.toLowerCase().includes(q)) return false;
    return true;
  });
}

function getAvailableActionsForItem(item) {
  const options = [{ value: 'skip', label: ACTION_LABELS.skip }];
  if (item.left) {
    options.push({ value: 'copy_to_right', label: ACTION_LABELS.copy_to_right });
    options.push({ value: 'delete_left', label: ACTION_LABELS.delete_left });
  }
  if (item.right) {
    options.push({ value: 'copy_to_left', label: ACTION_LABELS.copy_to_left });
    options.push({ value: 'delete_right', label: ACTION_LABELS.delete_right });
  }
  return options;
}

function renderCountsAndPlannedSummary() {
  const analysis = getActiveAnalysis();
  const counts = analysis
    ? analysis.counts
    : { total: 0, only_left: 0, only_right: 0, newer_left: 0, newer_right: 0, identical: 0, conflict: 0 };

  const diffs =
    counts.only_left +
    counts.only_right +
    counts.newer_left +
    counts.newer_right +
    (counts.conflict || 0);

  document.getElementById('countAll').textContent = counts.total;
  document.getElementById('countDifferences').textContent = diffs;
  document.getElementById('countOnlyLeft').textContent = counts.only_left;
  document.getElementById('countOnlyRight').textContent = counts.only_right;
  document.getElementById('countNewerLeft').textContent = counts.newer_left;
  document.getElementById('countNewerRight').textContent = counts.newer_right;
  document.getElementById('countIdentical').textContent = counts.identical;

  let plannedCount = 0;
  if (analysis) {
    for (let i = 0; i < analysis.items.length; i++) {
      const it = analysis.items[i];
      if (it.checked && it.action !== 'skip') plannedCount++;
    }
  }

  document.getElementById('plannedOpsCount').textContent = plannedCount;
  document.getElementById('synchronizeBtn').disabled = plannedCount === 0;
}

function renderPreSyncDiagnosticReport() {
  const analysis = getActiveAnalysis();
  const oneSideListEl = document.getElementById('reportOneSideList');
  const bothNewerListEl = document.getElementById('reportBothNewerList');
  const oneSideCountEl = document.getElementById('reportOneSideCount');
  const bothNewerCountEl = document.getElementById('reportBothNewerCount');

  oneSideListEl.innerHTML = '';
  bothNewerListEl.innerHTML = '';

  if (!analysis) {
    oneSideCountEl.textContent = '0 files';
    bothNewerCountEl.textContent = '0 files';
    oneSideListEl.innerHTML =
      '<li class="muted-item">Run "Analyze" to list files that exist exclusively on Left or Right.</li>';
    bothNewerListEl.innerHTML =
      '<li class="muted-item">Run "Analyze" to list files present in both folders where one side has a newer timestamp.</li>';
    return;
  }

  const oneSideItems = [];
  const bothNewerItems = [];
  for (let i = 0; i < analysis.items.length; i++) {
    const it = analysis.items[i];
    if (it.status === 'only_left' || it.status === 'only_right') {
      oneSideItems.push(it);
    } else if (it.status === 'newer_left' || it.status === 'newer_right' || it.status === 'conflict') {
      bothNewerItems.push(it);
    }
  }

  oneSideCountEl.textContent = `${oneSideItems.length} file(s)`;
  bothNewerCountEl.textContent = `${bothNewerItems.length} file(s)`;

  if (oneSideItems.length === 0) {
    oneSideListEl.innerHTML =
      '<li class="muted-item">No files exist exclusively on one side.</li>';
  } else {
    const frag = document.createDocumentFragment();
    const limit = Math.min(oneSideItems.length, REPORT_LIST_CAP);
    for (let i = 0; i < limit; i++) {
      const item = oneSideItems[i];
      const li = document.createElement('li');
      const sideBadge = item.status === 'only_left' ? '[ONLY LEFT]' : '[ONLY RIGHT]';
      const actionBadge = item.checked ? ACTION_LABELS[item.action] : 'Skipped';

      const leftSpan = document.createElement('span');
      leftSpan.textContent = `${sideBadge} ${item.relPath}`;
      const rightSpan = document.createElement('span');
      rightSpan.textContent = `➔ ${actionBadge}`;
      li.appendChild(leftSpan);
      li.appendChild(rightSpan);
      frag.appendChild(li);
    }
    if (oneSideItems.length > REPORT_LIST_CAP) {
      const moreLi = document.createElement('li');
      moreLi.className = 'muted-item';
      moreLi.textContent = `...and ${oneSideItems.length - REPORT_LIST_CAP} more files (use main table or Copy Full Report to inspect all).`;
      frag.appendChild(moreLi);
    }
    oneSideListEl.appendChild(frag);
  }

  if (bothNewerItems.length === 0) {
    bothNewerListEl.innerHTML =
      '<li class="muted-item">All shared files have identical timestamps and sizes.</li>';
  } else {
    const frag = document.createDocumentFragment();
    const limit = Math.min(bothNewerItems.length, REPORT_LIST_CAP);
    for (let i = 0; i < limit; i++) {
      const item = bothNewerItems[i];
      const li = document.createElement('li');
      let detail;
      if (item.status === 'newer_left') {
        detail = `[NEWER ON LEFT by ${formatDurationDiff(item.timeDiffMs)}]`;
      } else if (item.status === 'newer_right') {
        detail = `[NEWER ON RIGHT by ${formatDurationDiff(item.timeDiffMs)}]`;
      } else {
        detail = '[SAME TIME / SIZE DIFF]';
      }
      const actionBadge = item.checked ? ACTION_LABELS[item.action] : 'Skipped';

      const leftSpan = document.createElement('span');
      leftSpan.textContent = `${detail} ${item.relPath}`;
      const rightSpan = document.createElement('span');
      rightSpan.textContent = `➔ ${actionBadge}`;
      li.appendChild(leftSpan);
      li.appendChild(rightSpan);
      frag.appendChild(li);
    }
    if (bothNewerItems.length > REPORT_LIST_CAP) {
      const moreLi = document.createElement('li');
      moreLi.className = 'muted-item';
      moreLi.textContent = `...and ${bothNewerItems.length - REPORT_LIST_CAP} more files.`;
      frag.appendChild(moreLi);
    }
    bothNewerListEl.appendChild(frag);
  }
}

function renderPaginationControls(totalFiltered) {
  const bar = document.getElementById('paginationBar');
  if (!totalFiltered || totalFiltered <= PAGE_SIZE) {
    bar.hidden = true;
    return;
  }

  bar.hidden = false;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  if (state.currentPage > totalPages) state.currentPage = totalPages;
  if (state.currentPage < 1) state.currentPage = 1;

  const startIdx = (state.currentPage - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(totalFiltered, state.currentPage * PAGE_SIZE);

  document.getElementById('paginationInfo').textContent = `Showing ${startIdx.toLocaleString()}–${endIdx.toLocaleString()} of ${totalFiltered.toLocaleString()} files`;
  document.getElementById('pageIndicator').textContent = `Page ${state.currentPage} / ${totalPages}`;

  document.getElementById('firstPageBtn').disabled = state.currentPage <= 1;
  document.getElementById('prevPageBtn').disabled = state.currentPage <= 1;
  document.getElementById('nextPageBtn').disabled = state.currentPage >= totalPages;
  document.getElementById('lastPageBtn').disabled = state.currentPage >= totalPages;
}

function renderComparisonTable() {
  const tbody = document.getElementById('comparisonTableBody');
  tbody.innerHTML = '';

  const analysis = getActiveAnalysis();
  if (!analysis) {
    document.getElementById('paginationBar').hidden = true;
    tbody.innerHTML = `
      <tr class="empty-state-row">
        <td colspan="6">
          <div class="empty-state-box">
            <div class="empty-state-title">Ready to Compare Folders</div>
            <p>Select a <strong>Left</strong> and <strong>Right</strong> folder above, choose your sync direction (<kbd>Left ➔ Right</kbd>, <kbd>⇄ Two-Way</kbd>, or <kbd>Left ⬅ Right</kbd>), and click <strong>Analyze</strong> to generate a full pre-sync diagnostic log of files only on one side and files present on both sides with newer timestamps.</p>
          </div>
        </td>
      </tr>
    `;
    renderCountsAndPlannedSummary();
    renderPreSyncDiagnosticReport();
    return;
  }

  const filtered = getFilteredItems();
  if (filtered.length === 0) {
    document.getElementById('paginationBar').hidden = true;
    tbody.innerHTML = `
      <tr class="empty-state-row">
        <td colspan="6">
          <div class="empty-state-box">
            <div class="empty-state-title">No Matching Files</div>
            <p>No files match the current filter (<strong>${state.activeFilter}</strong>) or search query.</p>
          </div>
        </td>
      </tr>
    `;
    renderCountsAndPlannedSummary();
    renderPreSyncDiagnosticReport();
    return;
  }

  renderPaginationControls(filtered.length);

  const startIndex = (state.currentPage - 1) * PAGE_SIZE;
  const pageSlice = filtered.slice(startIndex, startIndex + PAGE_SIZE);

  const fragment = document.createDocumentFragment();

  for (const item of pageSlice) {
    const tr = document.createElement('tr');

    // 1. Checkbox cell
    const tdCheck = document.createElement('td');
    tdCheck.className = 'col-check';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(item.checked);
    checkbox.setAttribute('aria-label', `Include ${item.relPath} in sync`);
    checkbox.addEventListener('change', () => {
      item.checked = checkbox.checked;
      if (item.checked && item.action === 'skip') {
        const job = getActiveJob();
        const fallback = computeDefaultActionForRow(item.status, job.direction, true);
        item.action = fallback !== 'skip' ? fallback : item.left ? 'copy_to_right' : 'copy_to_left';
        renderComparisonTable();
        return;
      }
      renderCountsAndPlannedSummary();
      renderPreSyncDiagnosticReport();
    });
    tdCheck.appendChild(checkbox);
    tr.appendChild(tdCheck);

    // 2. Relative Path row header (<th> per modern-web-guidance `responsive-table`) + [Hidden] / [System] badges
    const thPath = document.createElement('th');
    thPath.scope = 'row';
    thPath.className = 'col-path';
    const pathSpan = document.createElement('span');
    pathSpan.textContent = item.relPath;
    thPath.appendChild(pathSpan);

    if (item.isHidden) {
      const hBadge = document.createElement('span');
      hBadge.className = 'attr-tag attr-tag-hidden';
      hBadge.title =
        'Windows Hidden (+H) or OS Metadata file — hidden in File Explorer unless "Hidden items" is enabled';
      hBadge.textContent = 'Hidden';
      thPath.appendChild(hBadge);
    }
    if (item.isSystem) {
      const sBadge = document.createElement('span');
      sBadge.className = 'attr-tag attr-tag-system';
      sBadge.title =
        'Windows Protected OS (+S) file — hidden in File Explorer unless "Hide protected operating system files" is unchecked in Folder Options';
      sBadge.textContent = 'System';
      thPath.appendChild(sBadge);
    }

    tr.appendChild(thPath);

    // 3. Left Folder metadata
    const tdLeft = document.createElement('td');
    tdLeft.className = 'col-side';
    if (item.left) {
      tdLeft.innerHTML = `
        <div class="cell-meta">
          <span class="cell-size">${formatBytes(item.left.size)}</span>
          <span class="cell-mtime">${formatDate(item.left.mtimeMs)}</span>
        </div>
      `;
    } else {
      tdLeft.innerHTML = `<span class="cell-missing">— Not present on Left —</span>`;
    }
    tr.appendChild(tdLeft);

    // 4. Status cell
    const tdStatus = document.createElement('td');
    tdStatus.className = 'col-status';
    const badge = document.createElement('span');
    badge.className = `status-badge status-${item.status}`;
    let statusText = STATUS_LABELS[item.status] || item.status;
    if (item.status === 'newer_left' || item.status === 'newer_right') {
      statusText += ` (+${formatDurationDiff(item.timeDiffMs)})`;
    }
    badge.textContent = statusText;
    tdStatus.appendChild(badge);
    tr.appendChild(tdStatus);

    // 5. Action Override Dropdown
    const tdAction = document.createElement('td');
    tdAction.className = 'col-action';
    const select = document.createElement('select');
    const actionClass = item.action.startsWith('copy_')
      ? 'action-copy'
      : item.action.startsWith('delete_')
      ? 'action-delete'
      : '';
    select.className = `action-select ${actionClass}`;
    select.setAttribute('aria-label', `Planned action for ${item.relPath}`);

    for (const opt of getAvailableActionsForItem(item)) {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      optionEl.selected = item.action === opt.value;
      select.appendChild(optionEl);
    }

    select.addEventListener('change', () => {
      item.action = select.value;
      item.checked = item.action !== 'skip';
      renderComparisonTable();
    });

    tdAction.appendChild(select);
    tr.appendChild(tdAction);

    // 6. Right Folder metadata
    const tdRight = document.createElement('td');
    tdRight.className = 'col-side';
    if (item.right) {
      tdRight.innerHTML = `
        <div class="cell-meta">
          <span class="cell-size">${formatBytes(item.right.size)}</span>
          <span class="cell-mtime">${formatDate(item.right.mtimeMs)}</span>
        </div>
      `;
    } else {
      tdRight.innerHTML = `<span class="cell-missing">— Not present on Right —</span>`;
    }
    tr.appendChild(tdRight);

    fragment.appendChild(tr);

    // Right-click Context Menu handler for each file row
    tr.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openFileContextMenu(item, tr, e.clientX, e.clientY);
    });
  }

  tbody.appendChild(fragment);
  renderCountsAndPlannedSummary();
  renderPreSyncDiagnosticReport();
}

function switchJob(jobId) {
  state.activeJobId = jobId;
  state.currentPage = 1;
  renderJobSelectorAndTabs();
  renderActiveJobControls();
  renderComparisonTable();
  persistProfiles();
}

async function runAnalysis() {
  const job = getActiveJob();
  if (!job) return;

  job.leftDir = document.getElementById('leftDirInput').value.trim();
  job.rightDir = document.getElementById('rightDirInput').value.trim();
  await persistProfiles();

  if (!job.leftDir || !job.rightDir) {
    appendLog('warn', 'Please select both a Left folder and a Right folder before clicking Analyze.');
    document.getElementById('syncStatusBanner').textContent =
      'Select both Left and Right folders first';
    return;
  }

  const analyzeBtn = document.getElementById('analyzeBtn');
  analyzeBtn.disabled = true;
  document.getElementById('syncStatusBanner').textContent = 'Analyzing folders...';
  appendLog(
    'info',
    `Starting analysis for job "${job.name}": Left="${job.leftDir}" | Right="${job.rightDir}" | Direction=${DIRECTION_META[job.direction].label}`
  );

  try {
    const result = await mysyncAPI.analyzeFolders({
      leftDir: job.leftDir,
      rightDir: job.rightDir,
      direction: job.direction,
      propagateDeletions: job.propagateDeletions,
      skipHiddenSystem: Boolean(job.skipHiddenSystem),
      excludePatterns: job.excludePatterns || [],
    });

    state.analysisByJobId[job.id] = result;
    state.currentPage = 1;

    const c = result.counts;
    appendLog(
      'info',
      `PRE-SYNC SUMMARY — Total files scanned: ${c.total} | Only on Left: ${c.only_left} | Only on Right: ${c.only_right} | Both Sides (Newer on Left): ${c.newer_left} | Both Sides (Newer on Right): ${c.newer_right} | Identical: ${c.identical}`
    );

    // Log up to 150 individual pre-sync findings to Activity Log so huge 25k-file scans don't freeze the DOM
    let loggedCount = 0;
    const LOG_CAP = 150;
    for (const item of result.items) {
      if (item.status === 'identical') continue;
      if (loggedCount >= LOG_CAP) {
        appendLog('info', `...and ${result.items.length - loggedCount} additional entries (see Pre-Execution Sync Report tab and table above).`);
        break;
      }
      if (item.status === 'only_left') {
        appendLog('info', `[ONLY ON LEFT] ${item.relPath} (${formatBytes(item.left.size)}) -> Planned: ${ACTION_LABELS[item.action]}`);
        loggedCount++;
      } else if (item.status === 'only_right') {
        appendLog('info', `[ONLY ON RIGHT] ${item.relPath} (${formatBytes(item.right.size)}) -> Planned: ${ACTION_LABELS[item.action]}`);
        loggedCount++;
      } else if (item.status === 'newer_left') {
        appendLog(
          'warn',
          `[BOTH SIDES - NEWER ON LEFT by ${formatDurationDiff(item.timeDiffMs)}] ${item.relPath} (Left: ${formatDate(item.left.mtimeMs)} vs Right: ${formatDate(item.right.mtimeMs)}) -> Planned: ${ACTION_LABELS[item.action]}`
        );
        loggedCount++;
      } else if (item.status === 'newer_right') {
        appendLog(
          'warn',
          `[BOTH SIDES - NEWER ON RIGHT by ${formatDurationDiff(item.timeDiffMs)}] ${item.relPath} (Right: ${formatDate(item.right.mtimeMs)} vs Left: ${formatDate(item.left.mtimeMs)}) -> Planned: ${ACTION_LABELS[item.action]}`
        );
        loggedCount++;
      }
    }

    document.getElementById('syncStatusBanner').textContent =
      `Analysis complete: ${c.only_left + c.only_right} file(s) on one side only, ${c.newer_left + c.newer_right} file(s) newer on one side.`;

    renderComparisonTable();
  } catch (err) {
    appendLog('error', `Analysis error: ${err.message}`);
    document.getElementById('syncStatusBanner').textContent = `Analysis failed: ${err.message}`;
  } finally {
    analyzeBtn.disabled = false;
  }
}

function openConfirmSyncModal() {
  const job = getActiveJob();
  const analysis = getActiveAnalysis();
  if (!job || !analysis) return;

  const activeOps = analysis.items.filter((i) => i.checked && i.action !== 'skip');
  if (activeOps.length === 0) return;

  const oneSideOps = activeOps.filter(
    (i) => i.status === 'only_left' || i.status === 'only_right'
  );
  const bothNewerOps = activeOps.filter(
    (i) => i.status === 'newer_left' || i.status === 'newer_right' || i.status === 'conflict'
  );
  const otherOps = activeOps.filter(
    (i) => !oneSideOps.includes(i) && !bothNewerOps.includes(i)
  );

  document.getElementById('confirmSyncBanner').innerHTML = `
    <strong>Job:</strong> ${job.name} &nbsp;|&nbsp;
    <strong>Direction:</strong> ${DIRECTION_META[job.direction].label} &nbsp;|&nbsp;
    <strong>Total Operations to Execute:</strong> ${activeOps.length.toLocaleString()}
  `;

  document.getElementById('modalOneSideCount').textContent = oneSideOps.length.toLocaleString();
  const oneList = document.getElementById('modalOneSideList');
  oneList.innerHTML = '';
  if (oneSideOps.length === 0) {
    oneList.innerHTML = '<li>None</li>';
  } else {
    const cap = Math.min(oneSideOps.length, 300);
    for (let i = 0; i < cap; i++) {
      const op = oneSideOps[i];
      const li = document.createElement('li');
      const side = op.status === 'only_left' ? '[Only Left]' : '[Only Right]';
      li.textContent = `${side} ${op.relPath} ➔ ${ACTION_LABELS[op.action]}`;
      oneList.appendChild(li);
    }
    if (oneSideOps.length > cap) {
      const more = document.createElement('li');
      more.textContent = `...and ${(oneSideOps.length - cap).toLocaleString()} more files`;
      oneList.appendChild(more);
    }
  }

  document.getElementById('modalBothNewerCount').textContent = bothNewerOps.length.toLocaleString();
  const bothList = document.getElementById('modalBothNewerList');
  bothList.innerHTML = '';
  if (bothNewerOps.length === 0) {
    bothList.innerHTML = '<li>None</li>';
  } else {
    const cap = Math.min(bothNewerOps.length, 300);
    for (let i = 0; i < cap; i++) {
      const op = bothNewerOps[i];
      const li = document.createElement('li');
      const which =
        op.status === 'newer_left'
          ? `[Newer Left +${formatDurationDiff(op.timeDiffMs)}]`
          : op.status === 'newer_right'
          ? `[Newer Right +${formatDurationDiff(op.timeDiffMs)}]`
          : '[Conflict]';
      li.textContent = `${which} ${op.relPath} ➔ ${ACTION_LABELS[op.action]}`;
      bothList.appendChild(li);
    }
  }

  const otherSection = document.getElementById('modalOtherOpsSection');
  if (otherOps.length > 0) {
    otherSection.hidden = false;
    document.getElementById('modalOtherCount').textContent = otherOps.length.toLocaleString();
    const otherList = document.getElementById('modalOtherList');
    otherList.innerHTML = '';
    const cap = Math.min(otherOps.length, 200);
    for (let i = 0; i < cap; i++) {
      const op = otherOps[i];
      const li = document.createElement('li');
      li.textContent = `${op.relPath} ➔ ${ACTION_LABELS[op.action]}`;
      otherList.appendChild(li);
    }
  } else {
    otherSection.hidden = true;
  }

  const dialog = document.getElementById('confirmSyncDialog');
  dialog.showModal();
}

function appendModalLiveLog(level, message) {
  const box = document.getElementById('syncModalLiveLog');
  if (!box) return;
  const entry = document.createElement('div');
  entry.className = `log-entry level-${level}`;
  const icons = { info: '⏳', success: '✅', warn: '⚠️', error: '❌' };
  const timeStr = new Date().toLocaleTimeString();
  entry.textContent = `[${timeStr}] ${icons[level] || 'ℹ️'} ${message}`;
  box.appendChild(entry);
  while (box.children.length > 250) {
    box.removeChild(box.firstChild);
  }
  box.scrollTop = box.scrollHeight;
}

function updateLiveSyncModalProgress(progress) {
  const totalFiles = progress.total || 1;
  const currentIdx = progress.index || 0;
  document.getElementById('syncCounterLabel').textContent = `File ${currentIdx.toLocaleString()} of ${totalFiles.toLocaleString()}`;

  if (progress.relPath) {
    const actionPrefix =
      progress.action === 'copy_to_right'
        ? '[Copy L ➔ R] '
        : progress.action === 'copy_to_left'
        ? '[Copy R ➔ L] '
        : progress.action === 'delete_right'
        ? '[Delete Right] '
        : progress.action === 'delete_left'
        ? '[Delete Left] '
        : '';
    document.getElementById('syncCurrentFilePath').textContent = `${actionPrefix}${progress.relPath}`;
  }

  const elapsedSec = Math.max(0.1, (progress.elapsedMs || 100) / 1000);
  const bytesDone = progress.bytesTransferred || 0;
  const totalBytes = progress.totalBytesPlanned || 0;
  const speedBps = bytesDone / elapsedSec;
  document.getElementById('syncSpeedLabel').textContent = `${formatBytes(speedBps)}/s • Elapsed: ${elapsedSec.toFixed(1)}s`;

  // Overall progress bar (by bytes if totalBytes > 0, otherwise by file count)
  const overallPct =
    totalBytes > 0
      ? Math.min(100, Math.round((bytesDone / totalBytes) * 100))
      : Math.min(100, Math.round((currentIdx / totalFiles) * 100));

  document.getElementById('syncOverallProgressBar').style.width = `${overallPct}%`;
  document.getElementById('syncOverallBytesLabel').textContent =
    totalBytes > 0
      ? `${formatBytes(bytesDone)} / ${formatBytes(totalBytes)} (${overallPct}%)`
      : `${currentIdx} / ${totalFiles} files (${overallPct}%)`;

  // Current file progress bar
  if (typeof progress.fileSize === 'number' && progress.fileSize > 0) {
    const fileCopied = progress.fileBytesCopied || 0;
    const filePct = Math.min(100, Math.round((fileCopied / progress.fileSize) * 100));
    document.getElementById('syncCurrentFileProgressBar').style.width = `${filePct}%`;
    document.getElementById('syncCurrentFileBytesLabel').textContent = `${formatBytes(fileCopied)} / ${formatBytes(progress.fileSize)} (${filePct}%)`;
  } else {
    document.getElementById('syncCurrentFileProgressBar').style.width = '100%';
    document.getElementById('syncCurrentFileBytesLabel').textContent = 'Complete';
  }

  // Update main toolbar status strip too
  document.getElementById('syncStatusBanner').textContent =
    `Syncing [${currentIdx}/${totalFiles}] (${overallPct}%): ${progress.relPath || ''}`;

  // Append to logs on file-start, file-done, file-error, or cancelled (not every 180ms chunk)
  if (
    progress.phase === 'file-start' ||
    progress.phase === 'file-done' ||
    progress.phase === 'file-error' ||
    progress.phase === 'cancelled'
  ) {
    appendModalLiveLog(progress.level || 'info', `[${currentIdx}/${totalFiles}] ${progress.message}`);
    if (
      progress.phase !== 'file-start' &&
      (currentIdx <= 200 || currentIdx % 50 === 0 || currentIdx === totalFiles || progress.level === 'error')
    ) {
      appendLog(progress.level || 'info', `[${currentIdx}/${totalFiles}] ${progress.message}`);
    }
  }
}

async function executeConfirmedSync() {
  const confirmDialog = document.getElementById('confirmSyncDialog');
  if (confirmDialog.open) confirmDialog.close();

  const job = getActiveJob();
  const analysis = getActiveAnalysis();
  if (!job || !analysis) return;

  // Prepare & open the Live Sync Progress Modal
  const progressDialog = document.getElementById('syncProgressDialog');
  document.getElementById('syncProgressDialogTitle').textContent = `⚡ Synchronizing "${job.name}"...`;
  document.getElementById('closeSyncProgressBtn').hidden = true;
  document.getElementById('cancelSyncExecutionBtn').hidden = false;
  document.getElementById('cancelSyncExecutionBtn').disabled = false;
  document.getElementById('doneSyncExecutionBtn').hidden = true;
  document.getElementById('syncFinalSummarySection').hidden = true;
  document.getElementById('syncModalLiveLog').innerHTML = '';

  const phaseBadge = document.getElementById('syncPhaseBadge');
  phaseBadge.className = 'status-badge status-only_left';
  phaseBadge.textContent = 'SYNCING IN PROGRESS';

  document.getElementById('syncOverallProgressBar').style.width = '0%';
  document.getElementById('syncCurrentFileProgressBar').style.width = '0%';
  document.getElementById('syncCurrentFilePath').textContent = 'Starting synchronization...';

  if (!progressDialog.open) {
    progressDialog.showModal();
  }

  switchLogTab('activity');
  appendLog('info', `Executing synchronization for "${job.name}"...`);
  appendModalLiveLog('info', `Started synchronization for "${job.name}" (${DIRECTION_META[job.direction].label})`);
  document.getElementById('synchronizeBtn').disabled = true;

  try {
    const res = await mysyncAPI.executeSync({
      leftDir: job.leftDir,
      rightDir: job.rightDir,
      operations: analysis.items,
    });

    const elapsedSec = ((res.durationMs || 0) / 1000).toFixed(1);
    const totalDeleted = (res.deletedRight || 0) + (res.deletedLeft || 0);

    // Transition modal to Final Summary view
    document.getElementById('closeSyncProgressBtn').hidden = false;
    document.getElementById('cancelSyncExecutionBtn').hidden = true;
    document.getElementById('doneSyncExecutionBtn').hidden = false;
    document.getElementById('syncFinalSummarySection').hidden = false;

    if (res.cancelled) {
      document.getElementById('syncProgressDialogTitle').textContent = `⏹ Synchronization Cancelled`;
      phaseBadge.className = 'status-badge status-newer_left';
      phaseBadge.textContent = 'CANCELLED BY USER';
      document.getElementById('syncFinalBanner').innerHTML =
        `<strong>Stopped early:</strong> Synchronization was cancelled by the user after ${elapsedSec}s.`;
    } else if (res.errors.length > 0) {
      document.getElementById('syncProgressDialogTitle').textContent = `⚠️ Synchronization Completed with ${res.errors.length} Error(s)`;
      phaseBadge.className = 'status-badge status-newer_right';
      phaseBadge.textContent = 'COMPLETED WITH ERRORS';
      document.getElementById('syncFinalBanner').innerHTML =
        `<strong>Finished with warnings:</strong> ${res.copiedToRight + res.copiedToLeft} file(s) copied, ${totalDeleted} deleted, ${res.errors.length} error(s) in ${elapsedSec}s.`;
    } else {
      document.getElementById('syncProgressDialogTitle').textContent = `✅ Synchronization Complete!`;
      phaseBadge.className = 'status-badge status-identical';
      phaseBadge.textContent = '100% COMPLETED';
      document.getElementById('syncOverallProgressBar').style.width = '100%';
      document.getElementById('syncCurrentFileProgressBar').style.width = '100%';
      document.getElementById('syncCurrentFilePath').textContent = 'All planned file operations completed successfully.';
      document.getElementById('syncFinalBanner').innerHTML =
        `<strong>Success!</strong> Transferred <strong>${formatBytes(res.bytesTransferred)}</strong> across <strong>${res.copiedToRight + res.copiedToLeft}</strong> file(s) and deleted <strong>${totalDeleted}</strong> file(s) in <strong>${elapsedSec}s</strong>.`;
    }

    document.getElementById('sumCopiedLR').textContent = res.copiedToRight.toLocaleString();
    document.getElementById('sumCopiedRL').textContent = res.copiedToLeft.toLocaleString();
    document.getElementById('sumDeleted').textContent = totalDeleted.toLocaleString();
    document.getElementById('sumBytes').textContent = formatBytes(res.bytesTransferred);
    document.getElementById('sumDuration').textContent = `${elapsedSec}s`;
    document.getElementById('sumErrors').textContent = res.errors.length.toLocaleString();

    const summaryMsg = `SUMMARY — Copied Left➔Right: ${res.copiedToRight} | Copied Right➔Left: ${res.copiedToLeft} | Deleted: ${totalDeleted} | Total Data: ${formatBytes(res.bytesTransferred)} | Duration: ${elapsedSec}s | Errors: ${res.errors.length}`;
    appendLog(res.errors.length ? 'warn' : 'success', summaryMsg);
    appendModalLiveLog(res.errors.length ? 'warn' : 'success', summaryMsg);

    await runAnalysis();
  } catch (err) {
    appendLog('error', `Synchronization failed: ${err.message}`);
    appendModalLiveLog('error', `Synchronization failed: ${err.message}`);
    document.getElementById('closeSyncProgressBtn').hidden = false;
    document.getElementById('cancelSyncExecutionBtn').hidden = true;
    document.getElementById('doneSyncExecutionBtn').hidden = false;
  }
}

function switchLogTab(tabName) {
  document.querySelectorAll('.log-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.logtab === tabName);
  });
  document.getElementById('preSyncReportPane').classList.toggle('active', tabName === 'presync');
  document.getElementById('activityLogPane').classList.toggle('active', tabName === 'activity');
}

function setupDialogLightDismissFallbacks() {
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    document.querySelectorAll('dialog[closedby="any"]').forEach((dialog) => {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (isDialogContent) return;
        dialog.close();
      });
    });
  }
}

/**
 * Fallback for focusgroup="menu nomemory" per modern-web-guidance `menu` guide.
 */
function setupMenuFocusgroupFallbacks() {
  if (!('focusGroup' in HTMLElement.prototype)) {
    document.querySelectorAll('[focusgroup~="menu"]').forEach((group) => {
      group.setAttribute('role', 'menu');
      group.querySelectorAll('button:not([role])').forEach((item) => {
        item.setAttribute('role', 'menuitem');
      });
      group.addEventListener(
        'keydown',
        (event) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          const items = [...group.querySelectorAll('button')]
            .filter((item) => item.closest('[focusgroup]') === group)
            .filter((item) => !item.disabled && item.getAttribute('aria-disabled') !== 'true');
          const current = items.indexOf(document.activeElement);
          if (current < 0) return;
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
              ? items.length - 1
              : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
          event.preventDefault();
          event.stopImmediatePropagation();
          items[next].focus({ preventScroll: true });
        },
        true
      );
    });
  }
}

function getFullPathsForItem(item) {
  const job = getActiveJob();
  if (!job || !item) return { leftFull: '', rightFull: '' };
  const sep = job.leftDir.includes('\\') || job.rightDir.includes('\\') ? '\\' : '/';
  const relNative = item.relPath.split('/').join(sep);
  const cleanLeft = job.leftDir.replace(/[\\/]+$/, '');
  const cleanRight = job.rightDir.replace(/[\\/]+$/, '');
  return {
    leftFull: `${cleanLeft}${sep}${relNative}`,
    rightFull: `${cleanRight}${sep}${relNative}`,
  };
}

function openFileContextMenu(item, rowEl, clientX, clientY) {
  state.contextItem = item;

  document
    .querySelectorAll('tbody tr.context-active-row')
    .forEach((r) => r.classList.remove('context-active-row'));
  if (rowEl) rowEl.classList.add('context-active-row');

  const popover = document.getElementById('fileContextMenuPopover');
  document.getElementById('ctxMenuHeaderPath').textContent = item.relPath;

  const hasLeft = Boolean(item.left);
  const hasRight = Boolean(item.right);
  const fileName = item.relPath.split('/').pop();
  const extMatch = fileName.includes('.') ? `.${fileName.split('.').pop()}` : null;
  const parts = item.relPath.split('/');
  const parentFolderRelPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;

  // Enable / disable items depending on whether the file exists on Left / Right
  document.getElementById('ctxRevealLeft').disabled = !hasLeft;
  document.getElementById('ctxRevealRight').disabled = !hasRight;
  document.getElementById('ctxOpenLeft').disabled = !hasLeft;
  document.getElementById('ctxOpenRight').disabled = !hasRight;
  document.getElementById('ctxSyncNowLR').disabled = !hasLeft;
  document.getElementById('ctxSyncNowRL').disabled = !hasRight;

  document.getElementById('ctxPlanCopyLR').disabled = !hasLeft;
  document.getElementById('ctxPlanCopyRL').disabled = !hasRight;

  document
    .getElementById('ctxPlanCopyLR')
    .setAttribute('aria-checked', item.checked && item.action === 'copy_to_right' ? 'true' : 'false');
  document
    .getElementById('ctxPlanCopyRL')
    .setAttribute('aria-checked', item.checked && item.action === 'copy_to_left' ? 'true' : 'false');
  document
    .getElementById('ctxPlanSkip')
    .setAttribute('aria-checked', !item.checked || item.action === 'skip' ? 'true' : 'false');

  // Dynamic exclusion labels
  const folderBtn = document.getElementById('ctxExcludeParentFolder');
  if (parentFolderRelPath) {
    folderBtn.disabled = false;
    folderBtn.textContent = `🚫 Exclude Parent Folder ("${parentFolderRelPath}")`;
  } else {
    folderBtn.disabled = true;
    folderBtn.textContent = `🚫 Exclude Parent Folder (root file)`;
  }

  document.getElementById('ctxExcludeFile').textContent = `🚫 Ignore File "${fileName}"`;
  const extBtn = document.getElementById('ctxExcludeExt');
  if (extMatch) {
    extBtn.disabled = false;
    extBtn.textContent = `🚫 Ignore Extension "*${extMatch}"`;
  } else {
    extBtn.disabled = true;
    extBtn.textContent = `🚫 Ignore Extension (none)`;
  }

  document.getElementById('ctxTrashLeft').disabled = !hasLeft;
  document.getElementById('ctxTrashRight').disabled = !hasRight;

  if (popover.matches(':popover-open')) {
    popover.hidePopover();
  }
  popover.showPopover();

  // Viewport-clamped fixed positioning
  const rect = popover.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampedX = Math.max(8, Math.min(clientX, vw - rect.width - 10));
  const clampedY = Math.max(8, Math.min(clientY, vh - rect.height - 10));
  popover.style.left = `${clampedX}px`;
  popover.style.top = `${clampedY}px`;

  // Focus first enabled item for immediate ArrowUp / ArrowDown navigation
  const firstEnabled = popover.querySelector('[focusgroup~="menu"] button:not(:disabled)');
  if (firstEnabled) firstEnabled.focus({ preventScroll: true });
}

async function handleContextMenuCommand(action) {
  const popover = document.getElementById('fileContextMenuPopover');
  if (popover.matches(':popover-open')) {
    popover.hidePopover();
  }

  const item = state.contextItem;
  const job = getActiveJob();
  if (!item || !job) return;

  const { leftFull, rightFull } = getFullPathsForItem(item);

  switch (action) {
    case 'reveal-left': {
      const res = await mysyncAPI.showItemInFolder(leftFull);
      if (res && res.fallbackParentOpened) {
        appendLog(
          'warn',
          `Opened parent folder "${res.parentDir}" because "${item.relPath}" has Windows [${[
            res.isHidden ? 'Hidden' : '',
            res.isSystem ? 'System' : '',
          ]
            .filter(Boolean)
            .join('/')}] attributes (hidden in Explorer unless "Hide protected operating system files" is unchecked in Folder Options).`
        );
      } else {
        appendLog('info', `Opened containing folder (Left): ${leftFull}`);
      }
      break;
    }
    case 'reveal-right': {
      const res = await mysyncAPI.showItemInFolder(rightFull);
      if (res && res.fallbackParentOpened) {
        appendLog(
          'warn',
          `Opened parent folder "${res.parentDir}" because "${item.relPath}" has Windows [${[
            res.isHidden ? 'Hidden' : '',
            res.isSystem ? 'System' : '',
          ]
            .filter(Boolean)
            .join('/')}] attributes (hidden in Explorer unless "Hide protected operating system files" is unchecked in Folder Options).`
        );
      } else {
        appendLog('info', `Opened containing folder (Right): ${rightFull}`);
      }
      break;
    }
    case 'open-left': {
      await mysyncAPI.openPath(leftFull);
      appendLog('info', `Opened file (Left): ${leftFull}`);
      break;
    }
    case 'open-right': {
      await mysyncAPI.openPath(rightFull);
      appendLog('info', `Opened file (Right): ${rightFull}`);
      break;
    }
    case 'preview-diff': {
      await openFilePreviewModal(item, leftFull, rightFull);
      break;
    }
    case 'sync-now-lr': {
      appendLog('info', `Syncing single file Left -> Right: ${item.relPath}...`);
      const res = await mysyncAPI.executeSync({
        leftDir: job.leftDir,
        rightDir: job.rightDir,
        operations: [{ relPath: item.relPath, action: 'copy_to_right', checked: true }],
      });
      if (res.errors.length === 0) {
        appendLog('success', `Single-file sync complete (Left -> Right): ${item.relPath}`);
      }
      await runAnalysis();
      break;
    }
    case 'sync-now-rl': {
      appendLog('info', `Syncing single file Right -> Left: ${item.relPath}...`);
      const res = await mysyncAPI.executeSync({
        leftDir: job.leftDir,
        rightDir: job.rightDir,
        operations: [{ relPath: item.relPath, action: 'copy_to_left', checked: true }],
      });
      if (res.errors.length === 0) {
        appendLog('success', `Single-file sync complete (Right -> Left): ${item.relPath}`);
      }
      await runAnalysis();
      break;
    }
    case 'plan-copy-lr': {
      item.action = 'copy_to_right';
      item.checked = true;
      renderComparisonTable();
      break;
    }
    case 'plan-copy-rl': {
      item.action = 'copy_to_left';
      item.checked = true;
      renderComparisonTable();
      break;
    }
    case 'plan-skip': {
      item.action = 'skip';
      item.checked = false;
      renderComparisonTable();
      break;
    }
    case 'exclude-file': {
      const fileName = item.relPath.split('/').pop();
      if (!job.excludePatterns.includes(fileName)) {
        job.excludePatterns.push(fileName);
        await persistProfiles();
      }
      appendLog('info', `Added "${fileName}" to Job Ignore Rules and re-analyzing...`);
      await runAnalysis();
      break;
    }
    case 'exclude-ext': {
      const fileName = item.relPath.split('/').pop();
      if (fileName.includes('.')) {
        const pattern = `*.${fileName.split('.').pop()}`;
        if (!job.excludePatterns.includes(pattern)) {
          job.excludePatterns.push(pattern);
          await persistProfiles();
        }
        appendLog('info', `Added extension "${pattern}" to Job Ignore Rules and re-analyzing...`);
        await runAnalysis();
      }
      break;
    }
    case 'exclude-parent-folder': {
      const parts = item.relPath.split('/');
      if (parts.length > 1) {
        const parentFolderRelPath = parts.slice(0, -1).join('/');
        if (!job.excludePatterns.includes(parentFolderRelPath)) {
          job.excludePatterns.push(parentFolderRelPath);
          await persistProfiles();
        }
        appendLog(
          'info',
          `Excluded parent folder "${parentFolderRelPath}" (and all its files & subfolders) and re-analyzing...`
        );
        await runAnalysis();
      }
      break;
    }
    case 'copy-relpath': {
      await navigator.clipboard.writeText(item.relPath);
      appendLog('info', `Copied relative path to clipboard: ${item.relPath}`);
      break;
    }
    case 'trash-left': {
      openConfirmTrashModal('Left', item.relPath, leftFull);
      break;
    }
    case 'trash-right': {
      openConfirmTrashModal('Right', item.relPath, rightFull);
      break;
    }
    default:
      break;
  }
}

async function openFilePreviewModal(item, leftFull, rightFull) {
  const preview = await mysyncAPI.readFilePreview({ leftFull, rightFull });
  document.getElementById('previewFileMetaBanner').innerHTML = `
    <strong>File:</strong> <code>${item.relPath}</code> &nbsp;|&nbsp;
    <strong>Status:</strong> ${STATUS_LABELS[item.status] || item.status}
  `;

  const leftMeta = document.getElementById('previewLeftMeta');
  const leftCode = document.getElementById('previewLeftCode');
  if (!preview.left.exists) {
    leftMeta.textContent = 'Not present on Left';
    leftCode.textContent = '— File does not exist in Left folder —';
  } else {
    leftMeta.textContent = `${formatBytes(preview.left.size)} • ${formatDate(preview.left.mtimeMs)}`;
    leftCode.textContent = preview.left.isBinary
      ? `[Binary File — ${formatBytes(preview.left.size)}]`
      : preview.left.text + (preview.left.truncated ? '\n\n... [Truncated at 64 KB]' : '');
  }

  const rightMeta = document.getElementById('previewRightMeta');
  const rightCode = document.getElementById('previewRightCode');
  if (!preview.right.exists) {
    rightMeta.textContent = 'Not present on Right';
    rightCode.textContent = '— File does not exist in Right folder —';
  } else {
    rightMeta.textContent = `${formatBytes(preview.right.size)} • ${formatDate(preview.right.mtimeMs)}`;
    rightCode.textContent = preview.right.isBinary
      ? `[Binary File — ${formatBytes(preview.right.size)}]`
      : preview.right.text + (preview.right.truncated ? '\n\n... [Truncated at 64 KB]' : '');
  }

  document.getElementById('filePreviewDialog').showModal();
}

function openConfirmTrashModal(sideLabel, relPath, fullPath) {
  state.pendingTrashAction = { sideLabel, relPath, fullPath };
  document.getElementById('confirmTrashMessage').innerHTML = `
    Are you sure you want to move the <strong>${sideLabel}</strong> copy of <code>${relPath}</code> to the Windows Recycle Bin?<br/><br/>
    <span class="form-hint">${fullPath}</span>
  `;
  document.getElementById('confirmTrashDialog').showModal();
}

async function initApp() {
  setupDialogLightDismissFallbacks();
  setupMenuFocusgroupFallbacks();

  const saved = await mysyncAPI.loadProfiles();
  state.jobs = saved.jobs;
  state.activeJobId = saved.activeJobId || saved.jobs[0].id;

  renderJobSelectorAndTabs();
  renderActiveJobControls();
  renderComparisonTable();

  const activeJob = getActiveJob();
  appendLog('info', `Application started, profile: "${activeJob ? activeJob.name : 'default profile'}"`);

  mysyncAPI.onSyncProgress((progress) => {
    updateLiveSyncModalProgress(progress);
  });

  // Browse Left & Right
  document.getElementById('browseLeftBtn').addEventListener('click', async () => {
    const job = getActiveJob();
    const chosen = await mysyncAPI.selectFolder(job.leftDir);
    if (chosen) {
      job.leftDir = chosen;
      document.getElementById('leftDirInput').value = chosen;
      await persistProfiles();
    }
  });

  document.getElementById('browseRightBtn').addEventListener('click', async () => {
    const job = getActiveJob();
    const chosen = await mysyncAPI.selectFolder(job.rightDir);
    if (chosen) {
      job.rightDir = chosen;
      document.getElementById('rightDirInput').value = chosen;
      await persistProfiles();
    }
  });

  // Open Left & Right in Explorer
  document.getElementById('openLeftBtn').addEventListener('click', () => {
    const val = document.getElementById('leftDirInput').value.trim();
    if (val) mysyncAPI.openPath(val);
  });

  document.getElementById('openRightBtn').addEventListener('click', () => {
    const val = document.getElementById('rightDirInput').value.trim();
    if (val) mysyncAPI.openPath(val);
  });

  // Path input changes
  document.getElementById('leftDirInput').addEventListener('change', (e) => {
    const job = getActiveJob();
    if (job) {
      job.leftDir = e.target.value.trim();
      persistProfiles();
    }
  });

  document.getElementById('rightDirInput').addEventListener('change', (e) => {
    const job = getActiveJob();
    if (job) {
      job.rightDir = e.target.value.trim();
      persistProfiles();
    }
  });

  // Direction toggle button ("Change" arrow) cycles through the 3 modes
  document.getElementById('directionToggleBtn').addEventListener('click', () => {
    const job = getActiveJob();
    if (!job) return;
    const idx = DIRECTION_CYCLE.indexOf(job.direction);
    const nextDir = DIRECTION_CYCLE[(idx + 1) % DIRECTION_CYCLE.length];
    setDirection(nextDir);
  });

  // Explicit 1-click direction buttons
  document.querySelectorAll('.dir-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setDirection(btn.dataset.dir);
    });
  });

  // Pagination controls
  document.getElementById('firstPageBtn').addEventListener('click', () => {
    state.currentPage = 1;
    renderComparisonTable();
  });
  document.getElementById('prevPageBtn').addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      renderComparisonTable();
    }
  });
  document.getElementById('nextPageBtn').addEventListener('click', () => {
    const totalPages = Math.ceil(getFilteredItems().length / PAGE_SIZE);
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderComparisonTable();
    }
  });
  document.getElementById('lastPageBtn').addEventListener('click', () => {
    state.currentPage = Math.max(1, Math.ceil(getFilteredItems().length / PAGE_SIZE));
    renderComparisonTable();
  });

  // Propagate Deletions (Mirror) toggle
  document.getElementById('propagateDeletionsCheckbox').addEventListener('change', (e) => {
    const job = getActiveJob();
    if (!job) return;
    job.propagateDeletions = e.target.checked;
    recalculateActionsForCurrentJob();
    renderComparisonTable();
    persistProfiles();
  });

  // Skip Hidden & System files toggle
  const skipHiddenEl = document.getElementById('skipHiddenSystemCheckbox');
  if (skipHiddenEl) {
    skipHiddenEl.addEventListener('change', async (e) => {
      const job = getActiveJob();
      if (!job) return;
      job.skipHiddenSystem = e.target.checked;
      await persistProfiles();
      if (getActiveAnalysis()) {
        await runAnalysis();
      }
    });
  }

  // Filter pills
  document.querySelectorAll('.filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      state.activeFilter = pill.dataset.filter;
      state.currentPage = 1;
      renderComparisonTable();
    });
  });

  // Search box
  document.getElementById('searchFilterInput').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    state.currentPage = 1;
    renderComparisonTable();
  });

  // Select All matching checkbox
  document.getElementById('selectAllCheckbox').addEventListener('change', (e) => {
    const checked = e.target.checked;
    const job = getActiveJob();
    for (const item of getFilteredItems()) {
      item.checked = checked;
      if (checked && item.action === 'skip') {
        const fallback = computeDefaultActionForRow(item.status, job.direction, true);
        item.action = fallback !== 'skip' ? fallback : item.left ? 'copy_to_right' : 'copy_to_left';
      }
    }
    renderComparisonTable();
  });

  // Analyze, Synchronize, Clear buttons
  document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);
  document.getElementById('synchronizeBtn').addEventListener('click', openConfirmSyncModal);
  document.getElementById('executeConfirmedSyncBtn').addEventListener('click', executeConfirmedSync);

  document.getElementById('clearBtn').addEventListener('click', () => {
    delete state.analysisByJobId[state.activeJobId];
    state.currentPage = 1;
    document.getElementById('syncStatusBanner').textContent =
      'Comparison cleared — Click Analyze to inspect folders';
    renderComparisonTable();
  });

  // Job management
  document.getElementById('addJobBtn').addEventListener('click', () => {
    const nextNum = state.jobs.length + 1;
    const newJob = {
      id: `job-${Date.now()}`,
      name: `New Job ${nextNum}`,
      leftDir: '',
      rightDir: '',
      direction: 'left_to_right',
      propagateDeletions: false,
      excludePatterns: ['.git', 'node_modules', '*.tmp', 'Thumbs.db', '.DS_Store'],
    };
    state.jobs.push(newJob);
    switchJob(newJob.id);
    appendLog('info', `Created job profile "${newJob.name}"`);
  });

  document.getElementById('jobSelectDropdown').addEventListener('change', (e) => {
    switchJob(e.target.value);
  });

  const renameDialog = document.getElementById('renameJobDialog');
  document.getElementById('renameJobBtn').addEventListener('click', () => {
    const job = getActiveJob();
    if (!job) return;
    document.getElementById('renameJobInput').value = job.name;
    renameDialog.showModal();
  });

  document.getElementById('closeRenameJobBtn').addEventListener('click', () => renameDialog.close());
  document.getElementById('cancelRenameJobBtn').addEventListener('click', () => renameDialog.close());
  document.getElementById('renameJobForm').addEventListener('submit', () => {
    const job = getActiveJob();
    const nextName = document.getElementById('renameJobInput').value.trim();
    if (job && nextName) {
      job.name = nextName;
      renderJobSelectorAndTabs();
      persistProfiles();
    }
  });

  document.getElementById('deleteJobBtn').addEventListener('click', () => {
    if (state.jobs.length <= 1) {
      appendLog('warn', 'Cannot delete the only remaining sync job.');
      return;
    }
    const job = getActiveJob();
    state.jobs = state.jobs.filter((j) => j.id !== job.id);
    delete state.analysisByJobId[job.id];
    switchJob(state.jobs[0].id);
    appendLog('info', `Deleted job profile "${job.name}"`);
  });

  // Settings Modal
  const settingsDialog = document.getElementById('settingsDialog');
  document.getElementById('openSettingsBtn').addEventListener('click', () => {
    const job = getActiveJob();
    if (!job) return;
    document.getElementById('jobNameInput').value = job.name;
    document.getElementById('excludePatternsInput').value = (job.excludePatterns || []).join('\n');
    const themeSelect = document.getElementById('themeSelectInput');
    if (themeSelect) {
      const currentScheme =
        document.querySelector('meta[name="color-scheme"]')?.content || 'light dark';
      themeSelect.value = currentScheme;
    }
    settingsDialog.showModal();
  });

  document.getElementById('closeSettingsBtn').addEventListener('click', () => settingsDialog.close());
  document.getElementById('cancelSettingsBtn').addEventListener('click', () => settingsDialog.close());

  document.getElementById('settingsForm').addEventListener('submit', () => {
    const job = getActiveJob();
    if (!job) return;
    const newName = document.getElementById('jobNameInput').value.trim();
    if (newName) job.name = newName;
    const rawPatterns = document.getElementById('excludePatternsInput').value;
    job.excludePatterns = rawPatterns
      .split(/[\r\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const themeSelect = document.getElementById('themeSelectInput');
    if (themeSelect) {
      const chosenScheme = themeSelect.value;
      const metaEl = document.querySelector('meta[name="color-scheme"]');
      if (metaEl) metaEl.content = chosenScheme;
      try {
        if (chosenScheme === 'light dark') {
          localStorage.removeItem('color-scheme');
        } else {
          localStorage.setItem('color-scheme', chosenScheme);
        }
      } catch {}
    }

    renderJobSelectorAndTabs();
    persistProfiles();
    appendLog('info', `Saved settings for "${job.name}" (${job.excludePatterns.length} exclusion patterns)`);
  });

  // Confirm Sync Dialog close buttons
  const confirmDialog = document.getElementById('confirmSyncDialog');
  document.getElementById('closeConfirmSyncBtn').addEventListener('click', () => confirmDialog.close());
  document.getElementById('cancelConfirmSyncBtn').addEventListener('click', () => confirmDialog.close());

  // Live Sync Progress & Final Summary Dialog buttons
  const syncProgressDialog = document.getElementById('syncProgressDialog');
  document.getElementById('closeSyncProgressBtn').addEventListener('click', () => syncProgressDialog.close());
  document.getElementById('doneSyncExecutionBtn').addEventListener('click', () => syncProgressDialog.close());
  document.getElementById('cancelSyncExecutionBtn').addEventListener('click', async () => {
    document.getElementById('cancelSyncExecutionBtn').disabled = true;
    appendModalLiveLog('warn', 'Stopping synchronization after current chunk...');
    await mysyncAPI.cancelSync();
  });

  // File Preview Dialog close buttons
  const previewDialog = document.getElementById('filePreviewDialog');
  document.getElementById('closeFilePreviewBtn').addEventListener('click', () => previewDialog.close());
  document.getElementById('closeFilePreviewFooterBtn').addEventListener('click', () => previewDialog.close());

  // Confirm Trash Dialog handlers
  const trashDialog = document.getElementById('confirmTrashDialog');
  document.getElementById('closeConfirmTrashBtn').addEventListener('click', () => trashDialog.close());
  document.getElementById('cancelConfirmTrashBtn').addEventListener('click', () => trashDialog.close());
  document.getElementById('executeConfirmTrashBtn').addEventListener('click', async () => {
    const pending = state.pendingTrashAction;
    trashDialog.close();
    if (!pending) return;
    try {
      await mysyncAPI.trashItem(pending.fullPath);
      appendLog('warn', `Moved ${pending.sideLabel} file to Recycle Bin: ${pending.relPath}`);
      await runAnalysis();
    } catch (err) {
      appendLog('error', `Failed to move ${pending.relPath} to Recycle Bin: ${err.message}`);
    }
  });

  // Right-click Context Menu Popover events
  const ctxPopover = document.getElementById('fileContextMenuPopover');
  ctxPopover.addEventListener('toggle', (e) => {
    if (e.newState === 'closed') {
      document
        .querySelectorAll('tbody tr.context-active-row')
        .forEach((r) => r.classList.remove('context-active-row'));
    }
  });

  document.getElementById('fileContextMenuGroup').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-ctx]');
    if (!btn || btn.disabled) return;
    handleContextMenuCommand(btn.dataset.ctx);
  });

  // Hover follows focus inside context menu per `menu` guide
  document.getElementById('fileContextMenuGroup').addEventListener('pointermove', (e) => {
    const btn = e.target.closest('button[data-ctx]');
    if (btn && !btn.disabled && document.activeElement !== btn) {
      btn.focus({ focusVisible: false });
    }
  });

  // Log Tabs & Log actions
  document.querySelectorAll('.log-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchLogTab(btn.dataset.logtab));
  });

  document.getElementById('clearLogBtn').addEventListener('click', () => {
    document.getElementById('activityLogStream').innerHTML = '';
  });

  document.getElementById('copyReportBtn').addEventListener('click', async () => {
    const analysis = getActiveAnalysis();
    if (!analysis) return;
    const lines = [
      `=== MySync Pre-Execution Diagnostic Report ===`,
      `Left Folder: ${analysis.leftDir}`,
      `Right Folder: ${analysis.rightDir}`,
      `Direction: ${DIRECTION_META[analysis.direction].label}`,
      ``,
      `1. FILES ONLY ON ONE SIDE:`,
      ...analysis.items
        .filter((i) => i.status === 'only_left' || i.status === 'only_right')
        .map((i) => `  - [${i.status.toUpperCase()}] ${i.relPath} -> ${ACTION_LABELS[i.action]}`),
      ``,
      `2. FILES ON BOTH SIDES (NEWER ON ONE SIDE):`,
      ...analysis.items
        .filter((i) => i.status === 'newer_left' || i.status === 'newer_right' || i.status === 'conflict')
        .map(
          (i) =>
            `  - [${i.status.toUpperCase()} (${formatDurationDiff(i.timeDiffMs)})] ${i.relPath} -> ${ACTION_LABELS[i.action]}`
        ),
    ];
    await navigator.clipboard.writeText(lines.join('\n'));
    appendLog('info', 'Copied Full Pre-Execution Sync Report to clipboard.');
  });
}

window.addEventListener('DOMContentLoaded', initApp);
