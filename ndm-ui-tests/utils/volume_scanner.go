package utils

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"os/exec"
	"strings"
	"time"
	"unicode/utf16"

	"ndm-ui-tests/config"

	"golang.org/x/crypto/ssh"
)

// DiscoverySummary holds aggregate counts from a real volume scan,
// matching what the discovery report CSV contains.
type DiscoverySummary struct {
	TotalCount        int
	RegularFilesCount int
	DirectoriesCount  int
	SymlinksCount     int
}

// LocalScanNFSVolumeForDiscovery mounts the NFS export read-only on the
// local machine (the CI runner), counts files/dirs/symlinks using find,
// and returns aggregate totals. The mount is cleaned up before returning.
func LocalScanNFSVolumeForDiscovery(nfsExport string) (*DiscoverySummary, error) {
	uid := fmt.Sprintf("%d", time.Now().UnixNano())
	mp := fmt.Sprintf("/mnt/scan_discovery_%s", uid)

	script := fmt.Sprintf(`set -e
if ! command -v mount.nfs >/dev/null 2>&1; then
  sudo apt-get install -y nfs-common >/dev/null 2>&1
fi
sudo mkdir -p "%[1]s"
sudo mount -o ro -t nfs "%[2]s" "%[1]s"

total=$(sudo find "%[1]s" -mindepth 1 -not -path '*/.snapshot/*' | wc -l)
files=$(sudo find "%[1]s" -mindepth 1 -type f -not -path '*/.snapshot/*' | wc -l)
dirs=$(sudo find "%[1]s" -mindepth 1 -type d -not -path '*/.snapshot/*' | wc -l)
links=$(sudo find "%[1]s" -mindepth 1 -type l -not -path '*/.snapshot/*' | wc -l)

sudo umount "%[1]s" || sudo umount -l "%[1]s"
sudo rm -rf "%[1]s"

echo "${total},${files},${dirs},${links}"
`, mp, nfsExport)

	cmd := exec.Command("bash", "-c", script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("local discovery scan failed: %w\noutput: %s", err, string(out))
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	lastLine := lines[len(lines)-1]

	var total, files, dirs, links int
	_, err = fmt.Sscanf(lastLine, "%d,%d,%d,%d", &total, &files, &dirs, &links)
	if err != nil {
		return nil, fmt.Errorf("parse scan output %q: %w", lastLine, err)
	}

	return &DiscoverySummary{
		TotalCount:        total,
		RegularFilesCount: files,
		DirectoriesCount:  dirs,
		SymlinksCount:     links,
	}, nil
}

// LocalScanNFSWithLsLR mounts the NFS export read-only on the local machine,
// counts regular files and directories using ls -lR (matching the manual
// command used to verify volumes in CI), and returns a DiscoverySummary.
//
// The approach mirrors:
//
//	output=$(sudo ls -lR /mnt/nfs-src 2>/dev/null)
//	echo "Files:       $(echo "$output" | grep "^-" | wc -l)"
//	echo "Directories: $(echo "$output" | grep "^d" | wc -l)"
//
// Counts:
//   - Regular files  → lines whose first character is "-"
//   - Directories    → lines whose first character is "d"
//   - TotalCount     → files + directories
func LocalScanNFSWithLsLR(nfsExport string) (*DiscoverySummary, error) {
	uid := fmt.Sprintf("%d", time.Now().UnixNano())
	mp := fmt.Sprintf("/mnt/scan_lslr_%s", uid)

	// Mount read-only, run ls -lR, parse counts, unmount — all in one shell script.
	// Install nfs-common on first use if mount.nfs is absent (e.g. fresh CI runner).
	script := fmt.Sprintf(`set -e
if ! command -v mount.nfs >/dev/null 2>&1; then
  sudo apt-get install -y nfs-common >/dev/null 2>&1
fi
sudo mkdir -p "%[1]s"
sudo mount -o ro -t nfs "%[2]s" "%[1]s"

OUTPUT=$(sudo ls -lR "%[1]s" 2>/dev/null)
FILES=$(echo "$OUTPUT" | grep -c "^-" || true)
DIRS=$(echo "$OUTPUT" | grep -c "^d" || true)

sudo umount "%[1]s" || sudo umount -l "%[1]s"
sudo rm -rf "%[1]s"

echo "${FILES},${DIRS}"
`, mp, nfsExport)

	cmd := exec.Command("bash", "-c", script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("ls -lR scan failed: %w\noutput: %s", err, string(out))
	}

	line := strings.TrimSpace(string(out))
	// CombinedOutput may include banner lines; take the last non-empty line.
	parts := strings.Split(line, "\n")
	for i := len(parts) - 1; i >= 0; i-- {
		if strings.TrimSpace(parts[i]) != "" {
			line = strings.TrimSpace(parts[i])
			break
		}
	}

	var files, dirs int
	if _, err := fmt.Sscanf(line, "%d,%d", &files, &dirs); err != nil {
		return nil, fmt.Errorf("parse ls -lR output %q: %w", line, err)
	}

	return &DiscoverySummary{
		RegularFilesCount: files,
		DirectoriesCount:  dirs,
		TotalCount:        files + dirs,
	}, nil
}

// ─── NFS migration validation scan ───────────────────────────────────────────

// NFSFileStat holds the live metadata collected from a mounted NFS volume
// for one file or directory. Used to cross-check the NDM migration CoC report.
type NFSFileStat struct {
	Path        string // relative to mount root (no leading /)
	Type        string // "f" file | "d" directory | "l" symlink
	Size        int64
	UID         string // numeric UID
	GID         string // numeric GID
	Permissions string // octal, e.g. "755"
	Mtime       float64 // epoch seconds (decimal, sub-second precision)
	Atime       float64 // epoch seconds
}

// ScanNFSVolumeForMigrationValidation mounts the NFS export read-only on the
// local machine and collects per-entry metadata using find -printf.
// Returns a map keyed by the relative path (no leading slash) so callers can
// look up a file from a CoC CSV "Source Path" or "Destination Path" column.
//
// install nfs-common automatically if mount.nfs is missing (CI runner).
func ScanNFSVolumeForMigrationValidation(nfsExport string) (map[string]NFSFileStat, error) {
	uid := fmt.Sprintf("%d", time.Now().UnixNano())
	mp := fmt.Sprintf("/mnt/scan_mig_val_%s", uid)

	// %P  relative path (no mount-point prefix)
	// %y  type: f d l …
	// %s  size in bytes
	// %U  numeric UID
	// %G  numeric GID
	// %m  permissions in octal (without leading 0)
	// %T@ mtime epoch (seconds, decimal)
	// %A@ atime epoch (seconds, decimal)
	script := fmt.Sprintf(`set -e
if ! command -v mount.nfs >/dev/null 2>&1; then
  sudo apt-get install -y nfs-common >/dev/null 2>&1
fi
sudo mkdir -p "%[1]s"
sudo mount -o ro -t nfs "%[2]s" "%[1]s"

sudo find "%[1]s" -mindepth 1 -not -path '*/.snapshot/*' \
  -printf '%%P\t%%y\t%%s\t%%U\t%%G\t%%m\t%%T@\t%%A@\n'

sudo umount "%[1]s" || sudo umount -l "%[1]s"
sudo rm -rf "%[1]s"
`, mp, nfsExport)

	cmd := exec.Command("bash", "-c", script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("NFS migration scan failed: %w\noutput: %s", err, out)
	}

	result := make(map[string]NFSFileStat)
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) < 8 {
			continue
		}
		var size int64
		fmt.Sscanf(fields[2], "%d", &size)
		var mtime, atime float64
		fmt.Sscanf(fields[6], "%f", &mtime)
		fmt.Sscanf(fields[7], "%f", &atime)

		stat := NFSFileStat{
			Path:        fields[0],
			Type:        fields[1],
			Size:        size,
			UID:         fields[3],
			GID:         fields[4],
			Permissions: fields[5],
			Mtime:       mtime,
			Atime:       atime,
		}
		result[stat.Path] = stat
	}
	return result, nil
}

// ─── SMB volume scanning ──────────────────────────────────────────────────────

// ScanSMBVolumeForDiscovery SSHes into a Windows host and counts regular
// files and directories on an SMB share using PowerShell Get-ChildItem.
//
// The PowerShell script is Base64-encoded (UTF-16LE) and passed via
// -EncodedCommand so that passwords containing special characters never
// need shell-quoting.
//
// Parameters:
//
//	cfg        – SSH config for the Windows scan machine (e.g. 172.30.202.5)
//	smbHost    – IP/hostname of the SMB server  (e.g. "anf-xx.domain.local")
//	shareName  – SMB share name                (e.g. "vol1" or a clone name)
//	smbUser    – SMB access username           (e.g. "DOMAIN\\user")
//	smbPass    – SMB access password
func ScanSMBVolumeForDiscovery(cfg SSHConfig, smbHost, shareName, smbUser, smbPass string) (*DiscoverySummary, error) {
	psScript := buildSMBCountScript(smbHost, shareName, smbUser, smbPass)
	encoded := encodePSCommand(psScript)
	cmd := fmt.Sprintf(`powershell.exe -NonInteractive -NoProfile -EncodedCommand %s`, encoded)

	out, err := runSSHWithOutput(cfg, cmd)
	if err != nil {
		return nil, fmt.Errorf("SMB volume scan on %s: %w", cfg.Host, err)
	}

	line := lastNonEmpty(strings.TrimSpace(out))
	var files, dirs int
	if _, err := fmt.Sscanf(line, "%d,%d", &files, &dirs); err != nil {
		return nil, fmt.Errorf("parse SMB scan output %q: %w", line, err)
	}

	return &DiscoverySummary{
		RegularFilesCount: files,
		DirectoriesCount:  dirs,
		TotalCount:        files + dirs,
	}, nil
}

// buildSMBCountScript returns a PowerShell script that:
//  1. Maps the SMB share as a temporary PSDrive (SMPSCAN)
//  2. Counts regular files and directories recursively
//  3. Prints "<files>,<dirs>" to stdout
//  4. Removes the drive in a finally block
func buildSMBCountScript(smbHost, shareName, user, pass string) string {
	// Escape single quotes for PowerShell string literals (' → '')
	escapedPass := strings.ReplaceAll(pass, "'", "''")
	escapedUser := strings.ReplaceAll(user, "'", "''")
	escapedHost := strings.ReplaceAll(smbHost, "'", "''")
	escapedShare := strings.ReplaceAll(shareName, "'", "''")

	return fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
$unc = '\\%s\%s'
$securePwd = ConvertTo-SecureString '%s' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential('%s', $securePwd)
$drive = 'SMPSCAN'
if (Get-PSDrive -Name $drive -ErrorAction SilentlyContinue) {
    Remove-PSDrive -Name $drive -Force -ErrorAction SilentlyContinue
}
New-PSDrive -Name $drive -PSProvider FileSystem -Root $unc -Credential $cred | Out-Null
try {
    $files = @(Get-ChildItem -LiteralPath "${drive}:\" -Recurse -File -ErrorAction SilentlyContinue).Count
    $dirs  = @(Get-ChildItem -LiteralPath "${drive}:\" -Recurse -Directory -ErrorAction SilentlyContinue).Count
    Write-Host "$files,$dirs"
} finally {
    Remove-PSDrive -Name $drive -Force -ErrorAction SilentlyContinue
}
`, escapedHost, escapedShare, escapedPass, escapedUser)
}

// encodePSCommand Base64-encodes a PowerShell script in UTF-16LE format,
// which is what powershell.exe -EncodedCommand expects.
func encodePSCommand(script string) string {
	runes := utf16.Encode([]rune(script))
	b := make([]byte, len(runes)*2)
	for i, r := range runes {
		b[i*2] = byte(r)
		b[i*2+1] = byte(r >> 8)
	}
	return base64.StdEncoding.EncodeToString(b)
}

// runSSHWithOutput opens an SSH session and runs cmd, returning combined stdout.
// Unlike RunScript, this function does not impose an SSH connection dial timeout
// beyond the handshake — the command itself can run for as long as needed
// (important for scanning large SMB shares which can take several minutes).
func runSSHWithOutput(cfg SSHConfig, cmd string) (string, error) {
	sshCfg := &ssh.ClientConfig{
		User:            cfg.Username,
		Auth:            []ssh.AuthMethod{ssh.Password(cfg.Password)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), //nolint:gosec
		Timeout:         30 * time.Second,
	}
	client, err := ssh.Dial("tcp", fmt.Sprintf("%s:%d", cfg.Host, cfg.Port), sshCfg)
	if err != nil {
		return "", fmt.Errorf("SSH dial: %w", err)
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("SSH session: %w", err)
	}
	defer session.Close()

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	if err := session.Run(cmd); err != nil {
		return "", fmt.Errorf("SSH run: %w\nstdout: %s\nstderr: %s",
			err, stdout.String(), stderr.String())
	}
	return stdout.String(), nil
}

// ClearNFSVolume mounts nfsExport read-write and deletes all files and
// directories inside it, leaving the volume itself intact and empty.
// Excludes .snapshot (read-only on ANF) to avoid exit-code failures.
func ClearNFSVolume(nfsExport string) error {
	uid := fmt.Sprintf("%d", time.Now().UnixNano())
	mp := fmt.Sprintf("/mnt/clear_nfs_%s", uid)

	script := fmt.Sprintf(`set -e
if ! command -v mount.nfs >/dev/null 2>&1; then
  sudo apt-get install -y nfs-common >/dev/null 2>&1
fi
sudo mkdir -p "%[1]s"
sudo mount -t nfs "%[2]s" "%[1]s"

sudo find "%[1]s" -mindepth 1 -maxdepth 1 ! -name ".snapshot" -exec rm -rf {} +

sudo umount "%[1]s" || sudo umount -l "%[1]s"
sudo rm -rf "%[1]s"
`, mp, nfsExport)

	cmd := exec.Command("bash", "-c", script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("clear NFS volume %s: %w\noutput: %s", nfsExport, err, out)
	}
	return nil
}

// ClearSMBShare clears all files and directories inside the SMB share by
// running a PowerShell script on the Windows worker via SSH. This avoids DNS
// resolution issues on the Linux CI runner for AD domain names (.local).
func ClearSMBShare(host, share, username, password string) error {
	workerCfg := SSHConfig{
		Host:     config.SMBWorkerHost,
		Port:     config.SMBWorkerPort,
		Username: config.SMBWorkerUsername,
		Password: config.SMBWorkerPassword,
	}

	if workerCfg.Host == "" {
		return fmt.Errorf("NDM_SMB_WORKER_HOST not set — cannot clear SMB share via Windows worker")
	}

	uncPath := fmt.Sprintf(`\\%s\%s`, host, share)
	driveLetter := "Z:"

	psScript := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
$drive = "%s"
$share = "%s"
$user  = "%s"
$pass  = "%s"

try { net use $drive /delete /y 2>$null | Out-Null } catch {}
$mountOut = net use $drive $share /user:$user $pass 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "net use failed: $mountOut"
    exit 1
}

try {
    Get-ChildItem -Path "$drive\" -Recurse -Force -ErrorAction SilentlyContinue |
        Sort-Object { $_.FullName.Length } -Descending |
        Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
} catch {
    Write-Warning "Some items could not be removed: $_"
}

try { net use $drive /delete /y 2>$null | Out-Null } catch {}
Write-Output "OK"
`, driveLetter, uncPath, username, password)

	cmd := fmt.Sprintf(`powershell.exe -NoProfile -NonInteractive -EncodedCommand "%s"`,
		encodeSMBPowerShell(psScript))

	output, err := RunScript(workerCfg, cmd)
	if err != nil {
		return fmt.Errorf("clear SMB share %s via worker: %w\noutput: %s", uncPath, err, output)
	}

	if !strings.Contains(output, "OK") {
		return fmt.Errorf("clear SMB share %s: unexpected output: %s", uncPath, output)
	}
	return nil
}

// lastNonEmpty returns the last non-whitespace line from s.
func lastNonEmpty(s string) string {
	lines := strings.Split(s, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if t := strings.TrimSpace(lines[i]); t != "" {
			return t
		}
	}
	return ""
}

