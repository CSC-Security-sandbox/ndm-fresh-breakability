## Summary

This document provides instructions for building and running the Windows Worker installer for the Datamigrator application. Key steps include:

## Building the Windows Worker Installer

Follow these steps to create the installer:

### Install Inno Setup

- Download and install [Inno Setup](https://jrsoftware.org/isinfo.php).
- This tool is used to build the Windows installer.

### Download WinSW

- Get a suitable version of [WinSW](https://github.com/winsw/winsw/releases), e.g., `WinSW-x64.exe`.
- Rename the downloaded file to `winsw.exe`.

### Prepare the Binaries

- Rename your worker binary to `worker.exe`.
- Place both `worker.exe` and `winsw.exe` into the `wininstaller` directory.
- Copy the following helper scripts from the repo `scripts/` directory into the same `wininstaller` directory so they get bundled into the installer:
  - `scripts/stamp-metadata.ps1`
  - `scripts/README-stamp-metadata.md`

### Open the Inno Setup Script

- Launch Inno Setup.
- Open the `installer.iss` script file from the `wininstaller` directory.

### Build the Installer

- In Inno Setup, go to the **Build** menu and click **Compile**, or press `Ctrl + F9`.
- The installer `datamigrator-worker-setup.exe` will be generated inside the `wininstaller` directory.

## Requirements

### Microsoft Visual C++ Redistributable

- The worker requires the C++ Redistributable package to be installed on the machine where windows worker is supposed to be run.

## Running the Installer

- Run `datamigrator-worker-setup.exe`.
- During setup, enter the following values when prompted:
  - **Worker ID**
  - **Worker Secret**
  - **Control Plane IP**
  - **Project ID**
- Once installed, the Datamigrator Worker service starts automatically.
- The installation directory is:
  ```
  C:\datamigrator
  ```

- Logs can be found at:
  ```
  C:\datamigrator\logs
  ```

- Helper scripts are installed at:
  ```
  C:\datamigrator\scripts
  ```
  This directory contains:
  - `stamp-metadata.ps1` — admin utility to stamp NTFS ACLs, owner/group SIDs, timestamps, and file attributes from a source SMB share onto a destination SMB share. See `README-stamp-metadata.md` in the same folder for usage.

- Tail Logs in Real-Time. Open **PowerShell** and run:
  ```powershell
  Get-Content -Path "C:\datamigrator\logs\<log_file_name>" -Wait
  ```