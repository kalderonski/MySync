const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

/**
 * Known Windows / macOS hidden & protected system metadata filenames patterns
 * (e.g. Windows Media Player AlbumArt_{GUID}_Large.jpg, AlbumArtSmall.jpg, Folder.jpg, desktop.ini, Thumbs.db).
 */
const OS_PROTECTED_METADATA_REGEXES = [
  /^AlbumArt_.*$/i,
  /^AlbumArtSmall\.jpg$/i,
  /^desktop\.ini$/i,
  /^Thumbs\.db$/i,
  /^\.DS_Store$/i,
  /^\~\$.*$/,
];

function isWellKnownOSMetadataFile(fileName) {
  return OS_PROTECTED_METADATA_REGEXES.some((rx) => rx.test(fileName));
}

/**
 * Queries Windows `dir /A:H /S /B` and `dir /A:S /S /B` to get the exact set of
 * files/folders with the NTFS/FAT Hidden (+H) or System (+S) attribute inside rootDir.
 */
function runDirAttrQuery(rootDir, attrFlag) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(new Set());
    execFile(
      'cmd.exe',
      ['/d', '/s', '/c', `dir "${rootDir}" /A:${attrFlag} /S /B`],
      { maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (_err, stdout) => {
        const set = new Set();
        if (!stdout) return resolve(set);
        const normalizedRoot = path.resolve(rootDir).replace(/\\/g, '/').replace(/\/+$/, '') + '/';
        const lines = stdout.split(/\r?\n/);
        for (const raw of lines) {
          const trimmed = raw.trim();
          if (!trimmed) continue;
          const normFull = path.resolve(trimmed).replace(/\\/g, '/');
          if (normFull.toLowerCase().startsWith(normalizedRoot.toLowerCase())) {
            const rel = normFull.slice(normalizedRoot.length);
            if (rel) set.add(rel.toLowerCase());
          }
        }
        resolve(set);
      }
    );
  });
}

async function detectWindowsHiddenAndSystemSets(rootDir) {
  const [hiddenSet, systemSet] = await Promise.all([
    runDirAttrQuery(rootDir, 'H'),
    runDirAttrQuery(rootDir, 'S'),
  ]);
  return { hiddenSet, systemSet };
}

function hasPathOrAncestorInSet(relPath, attrSet) {
  if (!attrSet || attrSet.size === 0) return false;
  const lower = relPath.toLowerCase();
  if (attrSet.has(lower)) return true;
  const parts = lower.split('/');
  let prefix = '';
  for (let i = 0; i < parts.length - 1; i++) {
    prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
    if (attrSet.has(prefix)) return true;
  }
  return false;
}

/**
 * Converts a glob-style exclusion pattern (e.g., "*.tmp", "node_modules", ".git", "01_Only_Left/Finance")
 * into a matcher function against relative path segments or full relative path.
 */
function compileExcludePatterns(patterns = []) {
  const cleanPatterns = patterns
    .map((p) => p.trim())
    .filter(Boolean);

  const regexes = cleanPatterns.map((pattern) => {
    const normalized = pattern.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const escaped = normalized
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return {
      hasSlash: normalized.includes('/'),
      regex: normalized.includes('/')
        ? new RegExp(`^${escaped}(?:/.*)?$`, 'i')
        : new RegExp(`^${escaped}$`, 'i'),
    };
  });

  return function isExcluded(relPath) {
    const normalizedRel = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const segments = normalizedRel.split('/');
    for (const { hasSlash, regex } of regexes) {
      if (hasSlash) {
        if (regex.test(normalizedRel)) return true;
      } else {
        if (segments.some((seg) => regex.test(seg))) return true;
      }
    }
    return false;
  };
}

/**
 * Recursively scans a root directory and returns a Map of relativePath (POSIX) -> file metadata,
 * including `isHidden` and `isSystem` attributes.
 */
async function scanFolder(rootDir, excludePatterns = [], skipHiddenSystem = false) {
  const results = new Map();
  const isExcluded = compileExcludePatterns(excludePatterns);

  const rootStat = await fsp.stat(rootDir).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`Directory does not exist or is not accessible: "${rootDir}"`);
  }

  const { hiddenSet, systemSet } = await detectWindowsHiddenAndSystemSets(rootDir);

  async function walk(currentDir, relativePrefix = '') {
    let entries;
    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      throw new Error(`Cannot read directory "${currentDir}": ${err.message}`);
    }

    for (const entry of entries) {
      const relPath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      if (isExcluded(relPath)) continue;

      const isDotFile = entry.name.startsWith('.');
      const isOSMeta = isWellKnownOSMetadataFile(entry.name);
      const isWinHidden = hasPathOrAncestorInSet(relPath, hiddenSet);
      const isWinSystem = hasPathOrAncestorInSet(relPath, systemSet);

      const isHidden = isWinHidden || isDotFile || isOSMeta;
      const isSystem = isWinSystem || isOSMeta;

      if (skipHiddenSystem && (isHidden || isSystem)) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (entry.isFile()) {
        try {
          const stat = await fsp.stat(fullPath);
          results.set(relPath, {
            relPath,
            name: entry.name,
            fullPath,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            isHidden,
            isSystem,
          });
        } catch {
          // Ignore transient vanished files during scan
        }
      }
    }
  }

  await walk(rootDir, '');
  return results;
}

/**
 * Computes default sync action given a file status, job direction, and mirrorDeletion setting.
 */
function getDefaultAction(status, direction, propagateDeletions = false) {
  if (status === 'identical') return 'skip';

  if (direction === 'left_to_right') {
    switch (status) {
      case 'only_left':
      case 'newer_left':
      case 'conflict':
        return 'copy_to_right';
      case 'newer_right':
        return 'skip';
      case 'only_right':
        return propagateDeletions ? 'delete_right' : 'skip';
      default:
        return 'skip';
    }
  }

  if (direction === 'right_to_left') {
    switch (status) {
      case 'only_right':
      case 'newer_right':
      case 'conflict':
        return 'copy_to_left';
      case 'newer_left':
        return 'skip';
      case 'only_left':
        return propagateDeletions ? 'delete_left' : 'skip';
      default:
        return 'skip';
    }
  }

  // two_way
  switch (status) {
    case 'only_left':
    case 'newer_left':
      return 'copy_to_right';
    case 'only_right':
    case 'newer_right':
      return 'copy_to_left';
    default:
      return 'skip';
  }
}

/**
 * Compares two folders and returns detailed comparison items + summary counts.
 */
async function analyzeFolders({
  leftDir,
  rightDir,
  direction = 'left_to_right',
  propagateDeletions = false,
  skipHiddenSystem = false,
  excludePatterns = ['.git', 'node_modules', '*.tmp', 'Thumbs.db', '.DS_Store'],
  mtimeToleranceMs = 2000,
}) {
  const [leftMap, rightMap] = await Promise.all([
    scanFolder(leftDir, excludePatterns, skipHiddenSystem),
    scanFolder(rightDir, excludePatterns, skipHiddenSystem),
  ]);

  const allKeys = Array.from(new Set([...leftMap.keys(), ...rightMap.keys()])).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );

  const items = [];
  const counts = {
    total: allKeys.length,
    only_left: 0,
    only_right: 0,
    newer_left: 0,
    newer_right: 0,
    identical: 0,
    conflict: 0,
    hidden_or_system: 0,
  };

  for (const relPath of allKeys) {
    const left = leftMap.get(relPath) || null;
    const right = rightMap.get(relPath) || null;

    let status;
    let timeDiffMs = 0;

    if (left && !right) {
      status = 'only_left';
    } else if (!left && right) {
      status = 'only_right';
    } else {
      timeDiffMs = left.mtimeMs - right.mtimeMs;
      if (Math.abs(timeDiffMs) <= mtimeToleranceMs) {
        status = left.size === right.size ? 'identical' : 'conflict';
      } else if (timeDiffMs > mtimeToleranceMs) {
        status = 'newer_left';
      } else {
        status = 'newer_right';
      }
    }

    const isHidden = Boolean((left && left.isHidden) || (right && right.isHidden));
    const isSystem = Boolean((left && left.isSystem) || (right && right.isSystem));
    if (isHidden || isSystem) {
      counts.hidden_or_system++;
    }

    counts[status] = (counts[status] || 0) + 1;
    const defaultAction = getDefaultAction(status, direction, propagateDeletions);

    items.push({
      relPath,
      status,
      action: defaultAction,
      checked: defaultAction !== 'skip',
      timeDiffMs,
      isHidden,
      isSystem,
      left: left
        ? {
            size: left.size,
            mtimeMs: left.mtimeMs,
            isHidden: left.isHidden,
            isSystem: left.isSystem,
          }
        : null,
      right: right
        ? {
            size: right.size,
            mtimeMs: right.mtimeMs,
            isHidden: right.isHidden,
            isSystem: right.isSystem,
          }
        : null,
    });
  }

  return {
    leftDir,
    rightDir,
    direction,
    propagateDeletions,
    skipHiddenSystem,
    analyzedAt: new Date().toISOString(),
    counts,
    items,
  };
}

/**
 * Removes empty parent directories up to rootDir after file deletion.
 */
async function pruneEmptyParents(filePath, rootDir) {
  let current = path.dirname(filePath);
  const resolvedRoot = path.resolve(rootDir);
  while (current.startsWith(resolvedRoot) && path.resolve(current) !== resolvedRoot) {
    try {
      const entries = await fsp.readdir(current);
      if (entries.length === 0) {
        await fsp.rmdir(current);
        current = path.dirname(current);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

/**
 * Streams a file copy with live byte-level progress, speed (MB/s), and cancellation support.
 */
async function copyFileWithProgress(srcPath, destPath, fileSize, onChunkProgress, shouldCancel) {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });

  // For small files (< 2 MB), use fast atomic fsp.copyFile directly
  if (fileSize < 2 * 1024 * 1024) {
    await fsp.copyFile(srcPath, destPath);
    onChunkProgress(fileSize, fileSize);
    return;
  }

  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(srcPath, { highWaterMark: 4 * 1024 * 1024 }); // 4 MB chunks
    const writeStream = fs.createWriteStream(destPath);
    let copied = 0;
    let lastEmitMs = 0;

    function cleanupOnError(err) {
      readStream.destroy();
      writeStream.destroy();
      fs.unlink(destPath, () => reject(err));
    }

    readStream.on('data', (chunk) => {
      if (shouldCancel && shouldCancel()) {
        cleanupOnError(new Error('Synchronization cancelled by user'));
        return;
      }
      copied += chunk.length;
      const now = Date.now();
      if (now - lastEmitMs >= 180 || copied >= fileSize) {
        lastEmitMs = now;
        onChunkProgress(copied, fileSize);
      }
    });

    readStream.on('error', cleanupOnError);
    writeStream.on('error', cleanupOnError);

    writeStream.on('finish', () => {
      onChunkProgress(fileSize, fileSize);
      resolve();
    });

    readStream.pipe(writeStream);
  });
}

/**
 * Executes the selected file operations and emits live byte & file progress callbacks.
 */
async function executeSync({ leftDir, rightDir, operations }, onProgress = () => {}, shouldCancel = () => false) {
  const startTimeMs = Date.now();
  const activeOps = operations.filter((op) => op.checked && op.action && op.action !== 'skip');

  // Compute total bytes planned across all copy operations
  let totalBytesPlanned = 0;
  for (const op of activeOps) {
    if (op.action === 'copy_to_right' && op.left && typeof op.left.size === 'number') {
      totalBytesPlanned += op.left.size;
    } else if (op.action === 'copy_to_left' && op.right && typeof op.right.size === 'number') {
      totalBytesPlanned += op.right.size;
    }
  }

  const results = {
    totalPlanned: activeOps.length,
    totalBytesPlanned,
    copiedToRight: 0,
    copiedToLeft: 0,
    deletedRight: 0,
    deletedLeft: 0,
    bytesTransferred: 0,
    durationMs: 0,
    cancelled: false,
    errors: [],
    logs: [],
  };

  let completedBytesPriorFiles = 0;

  for (let i = 0; i < activeOps.length; i++) {
    if (shouldCancel()) {
      results.cancelled = true;
      const cancelMsg = `Synchronization cancelled by user after ${i} of ${activeOps.length} operations.`;
      results.logs.push({ level: 'warn', message: cancelMsg });
      onProgress({
        phase: 'cancelled',
        index: i,
        total: activeOps.length,
        bytesTransferred: results.bytesTransferred,
        totalBytesPlanned,
        level: 'warn',
        message: cancelMsg,
      });
      break;
    }

    const op = activeOps[i];
    const relNative = op.relPath.split('/').join(path.sep);
    const leftFull = path.join(leftDir, relNative);
    const rightFull = path.join(rightDir, relNative);

    try {
      if (op.action === 'copy_to_right' || op.action === 'copy_to_left') {
        const isLR = op.action === 'copy_to_right';
        const srcFull = isLR ? leftFull : rightFull;
        const dstFull = isLR ? rightFull : leftFull;
        const dirLabel = isLR ? 'Left ➔ Right' : 'Right ➔ Left';

        const stat = await fsp.stat(srcFull);
        const fileSize = stat.size;

        // Emit "starting file" event Immediately so the user sees large files (e.g. 33 GB .bak) before copying finishes!
        onProgress({
          phase: 'file-start',
          index: i + 1,
          total: activeOps.length,
          relPath: op.relPath,
          action: op.action,
          fileBytesCopied: 0,
          fileSize,
          bytesTransferred: completedBytesPriorFiles,
          totalBytesPlanned,
          elapsedMs: Date.now() - startTimeMs,
          level: 'info',
          message: `Copying (${dirLabel}): ${op.relPath} (${fileSize} bytes)...`,
        });

        await copyFileWithProgress(
          srcFull,
          dstFull,
          fileSize,
          (fileBytesCopied) => {
            onProgress({
              phase: 'file-chunk',
              index: i + 1,
              total: activeOps.length,
              relPath: op.relPath,
              action: op.action,
              fileBytesCopied,
              fileSize,
              bytesTransferred: completedBytesPriorFiles + fileBytesCopied,
              totalBytesPlanned,
              elapsedMs: Date.now() - startTimeMs,
            });
          },
          shouldCancel
        );

        await fsp.utimes(dstFull, stat.atime, stat.mtime);

        completedBytesPriorFiles += fileSize;
        results.bytesTransferred = completedBytesPriorFiles;
        if (isLR) results.copiedToRight++;
        else results.copiedToLeft++;

        const msg = `Copied ${dirLabel}: ${op.relPath} (${fileSize} bytes)`;
        results.logs.push({ level: 'success', message: msg, relPath: op.relPath, size: fileSize });
        onProgress({
          phase: 'file-done',
          index: i + 1,
          total: activeOps.length,
          relPath: op.relPath,
          action: op.action,
          fileBytesCopied: fileSize,
          fileSize,
          bytesTransferred: completedBytesPriorFiles,
          totalBytesPlanned,
          elapsedMs: Date.now() - startTimeMs,
          level: 'success',
          message: msg,
        });
      } else if (op.action === 'delete_right') {
        if (fs.existsSync(rightFull)) {
          await fsp.unlink(rightFull);
          await pruneEmptyParents(rightFull, rightDir);
        }
        results.deletedRight++;
        const msg = `Deleted on Right: ${op.relPath}`;
        results.logs.push({ level: 'warn', message: msg, relPath: op.relPath });
        onProgress({
          phase: 'file-done',
          index: i + 1,
          total: activeOps.length,
          relPath: op.relPath,
          action: op.action,
          bytesTransferred: completedBytesPriorFiles,
          totalBytesPlanned,
          elapsedMs: Date.now() - startTimeMs,
          level: 'warn',
          message: msg,
        });
      } else if (op.action === 'delete_left') {
        if (fs.existsSync(leftFull)) {
          await fsp.unlink(leftFull);
          await pruneEmptyParents(leftFull, leftDir);
        }
        results.deletedLeft++;
        const msg = `Deleted on Left: ${op.relPath}`;
        results.logs.push({ level: 'warn', message: msg, relPath: op.relPath });
        onProgress({
          phase: 'file-done',
          index: i + 1,
          total: activeOps.length,
          relPath: op.relPath,
          action: op.action,
          bytesTransferred: completedBytesPriorFiles,
          totalBytesPlanned,
          elapsedMs: Date.now() - startTimeMs,
          level: 'warn',
          message: msg,
        });
      }
    } catch (err) {
      if (shouldCancel()) {
        results.cancelled = true;
        break;
      }
      const errMsg = `Failed (${op.action}) on "${op.relPath}": ${err.message}`;
      results.errors.push({ relPath: op.relPath, action: op.action, error: err.message });
      results.logs.push({ level: 'error', message: errMsg, relPath: op.relPath });
      onProgress({
        phase: 'file-error',
        index: i + 1,
        total: activeOps.length,
        relPath: op.relPath,
        action: op.action,
        bytesTransferred: completedBytesPriorFiles,
        totalBytesPlanned,
        elapsedMs: Date.now() - startTimeMs,
        level: 'error',
        message: errMsg,
      });
    }
  }

  results.durationMs = Date.now() - startTimeMs;
  return results;
}

module.exports = {
  compileExcludePatterns,
  scanFolder,
  getDefaultAction,
  analyzeFolders,
  executeSync,
};
