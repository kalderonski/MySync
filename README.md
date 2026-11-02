# MySync Pro Studio

A modern, high-contrast directional and two-way folder synchronization desktop application for Windows built with Electron.

## Key Features

- **Directional & Two-Way Folder Sync**:
  - **Left ➔ Right (One-Way)**
  - **Left ⬅ Right (One-Way)**
  - **Left ⇄ Right (Two-Way)**
  - **Mirror Deletions Toggle**: Optionally delete extra files on the destination side that do not exist on the source side.
- **Clear Pre-Execution Breakdown & Diagnostic Audit**:
  - Explicit pre-sync report and confirmation modal separating:
    1. **Files Only on ONE Side** (`[ONLY LEFT]` / `[ONLY RIGHT]`)
    2. **Files on BOTH Sides (Newer on One Side)** (`[NEWER ON LEFT +Xd Yh]` / `[NEWER ON RIGHT +Xd Yh]`)
  - Live filter pills (`All Files`, `Differences`, `Only on Left`, `Only on Right`, `Both: Newer on Left`, `Both: Newer on Right`, `Identical`).
- **Right-Click File Context Menu**:
  - **Open Containing Folder (Left / Right)** in Windows Explorer (with automatic parent-folder fallback for Windows `Hidden` / `System` files).
  - **Open File with Default App (Left / Right)**.
  - **Preview & Compare File Contents (`Diff`)** in a side-by-side modal.
  - **Sync This Single File Immediately** (`Left ➔ Right` or `Right ➔ Left`).
  - **Exclude Parent Folder (and Subfolders)**, **Ignore Exact File Name**, or **Ignore Extension (`*.ext`)**.
  - **Move Left / Right File to Windows Recycle Bin**.
- **Windows Hidden & Protected OS (`+H` / `+S`) File Handling**:
  - Visual **`Hidden`** and **`System`** badges next to OS metadata files (e.g. `AlbumArt_*.jpg`, `desktop.ini`, `Thumbs.db`).
  - One-click **Skip Hidden & System files** toggle.
- **Multiple Job Profiles & Adaptive Themes**:
  - Create, rename, and switch between multiple saved job profiles.
  - Adaptive **Dark Studio**, **Light Clean**, and **System Default** color schemes.

## Getting Started

```bash
# Install dependencies
npm install

# Run in development
npm start

# Run unit tests
npm test

# Build Windows NSIS Setup Installer & Portable .exe (outputs to dist/)
npm run dist
```

