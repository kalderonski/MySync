const { execSync, spawn } = require('child_process');
const electronPath = require('electron');
const path = require('path');

// Close any existing MySync Electron instances so there is never a lock collision (Error code: 32)
try {
  execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore' });
} catch {
  // No existing electron.exe running
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.resolve(__dirname)], {
  env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
