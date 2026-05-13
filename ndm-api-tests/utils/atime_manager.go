package utils

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// AtimeEntry holds a single observed access time for a path on a worker.
// Path matches what was passed in (UNC for SMB, POSIX for NFS).
type AtimeEntry struct {
	Path      string    `json:"path"`
	AtimeUnix int64     `json:"atimeUnix"`
	IsSymlink bool      `json:"isSymlink"`
	IsDir     bool      `json:"isDir"`
	Atime     time.Time `json:"-"`
}

// SetSourceAtime sets the access time on a single source path on the currently
// attached worker. Mirrors the pattern of permissions_manager.go: build a
// protocol-aware script (touch -a for NFS, Set-ItemProperty -LastAccessTime for
// SMB), ship it over SSH via sshRunScript, and surface parsing/exit errors.
//
// `path` is interpreted protocol-natively:
//   - NFS: an absolute POSIX path on the mounted source (e.g. "/mnt/src/file.txt")
//   - SMB: a UNC path such as "\\<host>\<share>\path\to\file.txt"
//
// `atime` is truncated to seconds because both `touch -t` and PowerShell's
// LastAccessTime granularity normalize at that precision on typical shares.
func SetSourceAtime(path string, atime time.Time) error {
	cfg := GetAttachedWorkerDetails()
	sshConfig := SSHConfig{Username: cfg.Username, Host: cfg.Host, Port: cfg.Port, Password: cfg.Password}

	var script string
	switch PROTOCOL_TYPE {
	case ProtocolNFS:
		script = buildNFSSetAtimeScript(path, atime)
	case ProtocolSMB:
		script = buildSMBSetAtimeScript(path, atime)
	default:
		return fmt.Errorf("SetSourceAtime: unsupported PROTOCOL_TYPE %q", PROTOCOL_TYPE)
	}

	LogDebug(fmt.Sprintf("SetSourceAtime script: %s", script))
	output, err := sshRunScript(sshConfig, script)
	LogDebug(fmt.Sprintf("SetSourceAtime output: %s", output))
	if err != nil {
		return fmt.Errorf("SetSourceAtime failed: %w\noutput: %s", err, output)
	}
	return nil
}

// GetAtime reads access time for one or more paths on the attached worker.
// Returns one AtimeEntry per requested path, in the same order. Missing paths
// return AtimeUnix == 0; callers must check before comparing.
func GetAtime(paths []string) ([]AtimeEntry, error) {
	if len(paths) == 0 {
		return nil, nil
	}
	cfg := GetAttachedWorkerDetails()
	sshConfig := SSHConfig{Username: cfg.Username, Host: cfg.Host, Port: cfg.Port, Password: cfg.Password}

	var script string
	switch PROTOCOL_TYPE {
	case ProtocolNFS:
		script = buildNFSGetAtimeScript(paths)
	case ProtocolSMB:
		script = buildSMBGetAtimeScript(paths)
	default:
		return nil, fmt.Errorf("GetAtime: unsupported PROTOCOL_TYPE %q", PROTOCOL_TYPE)
	}

	output, err := sshRunScript(sshConfig, script)
	if err != nil {
		return nil, fmt.Errorf("GetAtime failed: %w\noutput: %s", err, output)
	}

	entries, err := parseAtimeOutput(output)
	if err != nil {
		return nil, fmt.Errorf("GetAtime parse failed: %w\noutput: %s", err, output)
	}
	return entries, nil
}

// ExpectAtimeEqual asserts that source and destination paths share the same
// access time (truncated to seconds). Useful as a final assertion after
// migration / cutover.
func ExpectAtimeEqual(sourcePath, destPath string) error {
	entries, err := GetAtime([]string{sourcePath, destPath})
	if err != nil {
		return err
	}
	if len(entries) != 2 {
		return fmt.Errorf("ExpectAtimeEqual: expected 2 entries, got %d", len(entries))
	}
	src, dst := entries[0], entries[1]
	if src.AtimeUnix == 0 || dst.AtimeUnix == 0 {
		return fmt.Errorf("ExpectAtimeEqual: one or both paths missing (src=%v dst=%v)", src, dst)
	}
	if src.AtimeUnix != dst.AtimeUnix {
		return fmt.Errorf("ExpectAtimeEqual: atime mismatch — source %s (%d) vs destination %s (%d)",
			sourcePath, src.AtimeUnix, destPath, dst.AtimeUnix)
	}
	return nil
}

// ExpectAtimeUnchanged asserts that a single path's atime did not move from
// the baseline observed earlier (used to verify discovery does not propagate
// atime).
func ExpectAtimeUnchanged(path string, baseline time.Time) error {
	entries, err := GetAtime([]string{path})
	if err != nil {
		return err
	}
	if len(entries) != 1 {
		return fmt.Errorf("ExpectAtimeUnchanged: expected 1 entry, got %d", len(entries))
	}
	got := entries[0]
	if got.AtimeUnix == 0 {
		return fmt.Errorf("ExpectAtimeUnchanged: path %s not found", path)
	}
	if got.AtimeUnix != baseline.Unix() {
		return fmt.Errorf("ExpectAtimeUnchanged: %s drifted (baseline %d, observed %d)",
			path, baseline.Unix(), got.AtimeUnix)
	}
	return nil
}

// ---- protocol-specific script builders / parsers ----

func buildNFSSetAtimeScript(path string, atime time.Time) string {
	// `touch -a -t [[CC]YY]MMDDhhmm[.ss]` sets only atime. We always emit full CCYYMMDDhhmm.ss.
	stamp := atime.UTC().Format("200601021504.05")
	return fmt.Sprintf(`touch -a -t %s %s && stat -c %%X %s`, stamp, shellEscape(path), shellEscape(path))
}

func buildNFSGetAtimeScript(paths []string) string {
	// Emit one JSON line per path using stat(1). %X = atime epoch, %F = file type.
	// Missing paths produce zeroed entries so callers can detect them.
	var parts []string
	for _, p := range paths {
		parts = append(parts, fmt.Sprintf(
			`if [ -e %[1]s ] || [ -L %[1]s ]; then printf '{"path":%[2]q,"atimeUnix":%%s,"isSymlink":%%s,"isDir":%%s}\n' "$(stat -c %%X %[1]s)" "$(if [ -L %[1]s ]; then echo true; else echo false; fi)" "$(if [ -d %[1]s ] && [ ! -L %[1]s ]; then echo true; else echo false; fi)"; else printf '{"path":%[2]q,"atimeUnix":0,"isSymlink":false,"isDir":false}\n'; fi`,
			shellEscape(p), p,
		))
	}
	return strings.Join(parts, " && ")
}

func buildSMBSetAtimeScript(path string, atime time.Time) string {
	// PowerShell: Set-ItemProperty -Name LastAccessTime; -Force ensures it overrides
	// reparse-point atime updates on link nodes. We mount the share on demand so
	// the helper is self-contained (mirrors permissions_manager.go).
	// `path` here is expected to be a UNC path so no drive mapping is necessary
	// when the worker has the share mapped externally; we still wrap in -Force.
	stamp := atime.UTC().Format("2006-01-02T15:04:05Z")
	ps := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
$ts = [DateTime]::Parse('%s').ToUniversalTime()
Set-ItemProperty -Path '%s' -Name LastAccessTime -Value $ts -Force
(Get-Item -LiteralPath '%s').LastAccessTimeUtc.ToString('o')
`, stamp, path, path)
	return wrapPowerShell(ps)
}

func buildSMBGetAtimeScript(paths []string) string {
	// Emit one JSON object per path using ConvertTo-Json -Compress on a PSCustomObject.
	var pathLits []string
	for _, p := range paths {
		pathLits = append(pathLits, fmt.Sprintf("'%s'", p))
	}
	ps := fmt.Sprintf(`
$ErrorActionPreference = 'Continue'
$paths = @(%s)
foreach ($p in $paths) {
    if (Test-Path -LiteralPath $p) {
        $item = Get-Item -LiteralPath $p -Force
        $isSym = ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
        $obj = [PSCustomObject]@{
            path       = $p
            atimeUnix  = [int64](($item.LastAccessTimeUtc - (Get-Date '1970-01-01' -AsUTC)).TotalSeconds)
            isSymlink  = [bool]$isSym
            isDir      = ($item -is [System.IO.DirectoryInfo])
        }
    } else {
        $obj = [PSCustomObject]@{ path = $p; atimeUnix = 0; isSymlink = $false; isDir = $false }
    }
    $obj | ConvertTo-Json -Compress
}
`, strings.Join(pathLits, ","))
	return wrapPowerShell(ps)
}

// wrapPowerShell wraps a multi-line PowerShell block so it can be sent through
// `cmd /C powershell -NoProfile -Command "..."` over SSH.
func wrapPowerShell(ps string) string {
	// Use base64 to avoid shell-quoting hell when the script contains backticks
	// or double quotes. The receiving side (Windows worker SSH) is expected to
	// have powershell.exe on PATH.
	return fmt.Sprintf(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand %s`,
		base64UTF16LE(ps))
}

// base64UTF16LE encodes a UTF-8 string as base64 of its UTF-16LE bytes — the
// format expected by powershell.exe -EncodedCommand.
func base64UTF16LE(s string) string {
	runes := []rune(s)
	buf := make([]byte, 0, len(runes)*2)
	for _, r := range runes {
		// Surrogate pair handling not required for ASCII PowerShell.
		if r > 0xFFFF {
			r1, r2 := 0xD800+((r-0x10000)>>10), 0xDC00+((r-0x10000)&0x3FF)
			buf = append(buf, byte(r1&0xFF), byte((r1>>8)&0xFF), byte(r2&0xFF), byte((r2>>8)&0xFF))
			continue
		}
		buf = append(buf, byte(r&0xFF), byte((r>>8)&0xFF))
	}
	return base64StdEncode(buf)
}

func base64StdEncode(b []byte) string {
	return base64.StdEncoding.EncodeToString(b)
}

func parseAtimeOutput(output string) ([]AtimeEntry, error) {
	var entries []AtimeEntry
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.HasPrefix(line, "{") {
			continue
		}
		var raw struct {
			Path      string `json:"path"`
			AtimeUnix int64  `json:"atimeUnix"`
			IsSymlink bool   `json:"isSymlink"`
			IsDir     bool   `json:"isDir"`
		}
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			// Some shells may interleave non-JSON debug output; skip silently
			// to keep the helper robust on noisy SSH transports.
			LogDebug(fmt.Sprintf("parseAtimeOutput: skipping non-JSON line %q (%v)", line, err))
			continue
		}
		entries = append(entries, AtimeEntry{
			Path:      raw.Path,
			AtimeUnix: raw.AtimeUnix,
			IsSymlink: raw.IsSymlink,
			IsDir:     raw.IsDir,
			Atime:     time.Unix(raw.AtimeUnix, 0).UTC(),
		})
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("no atime entries parsed from output")
	}
	return entries, nil
}

// shellEscape returns a single-quoted POSIX shell argument. Embedded single
// quotes are split: `it's` -> `'it'\''s'`.
func shellEscape(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// FormatAtimeUnix is a small convenience for logs / assertion messages.
func FormatAtimeUnix(unix int64) string {
	if unix == 0 {
		return "<missing>"
	}
	return strconv.FormatInt(unix, 10) + " (" + time.Unix(unix, 0).UTC().Format(time.RFC3339) + ")"
}

// SeedAtimeFixture creates a deterministic test fixture on the attached worker:
// a directory `root` containing `filePath`, sub-directory `dirPath`, and a
// symbolic link `linkPath` (pointing at `filePath`). All entries are stamped
// with `atime` so subsequent tests have a known starting state.
//
// The function is protocol-aware: it emits POSIX `mkdir/touch/ln -s/touch -a`
// for NFS and PowerShell `New-Item` / `Set-ItemProperty` for SMB. It is safe to
// re-run; an existing tree is removed first.
func SeedAtimeFixture(root, filePath, dirPath, linkPath string, atime time.Time) error {
	cfg := GetAttachedWorkerDetails()
	sshConfig := SSHConfig{Username: cfg.Username, Host: cfg.Host, Port: cfg.Port, Password: cfg.Password}

	var script string
	switch PROTOCOL_TYPE {
	case ProtocolNFS:
		stamp := atime.UTC().Format("200601021504.05")
		script = strings.Join([]string{
			fmt.Sprintf(`rm -rf %s`, shellEscape(root)),
			fmt.Sprintf(`mkdir -p %s`, shellEscape(root)),
			fmt.Sprintf(`mkdir -p %s`, shellEscape(dirPath)),
			fmt.Sprintf(`printf 'atime-fixture\n' > %s`, shellEscape(filePath)),
			fmt.Sprintf(`ln -snf %s %s`, shellEscape(filePath), shellEscape(linkPath)),
			fmt.Sprintf(`touch -a -t %s %s %s %s`, stamp, shellEscape(filePath), shellEscape(dirPath), shellEscape(linkPath)),
		}, " && ")
	case ProtocolSMB:
		// PowerShell — symbolic links require admin / Developer Mode on the
		// worker; we skip the link if New-Item fails so the rest of the fixture
		// still seeds. Tests that depend on the symlink case will surface a
		// follow-up failure in GetAtime.
		stamp := atime.UTC().Format("2006-01-02T15:04:05Z")
		ps := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
$ts = [DateTime]::Parse('%[5]s').ToUniversalTime()
if (Test-Path -LiteralPath '%[1]s') { Remove-Item -LiteralPath '%[1]s' -Recurse -Force }
New-Item -ItemType Directory -Path '%[1]s' -Force | Out-Null
New-Item -ItemType Directory -Path '%[3]s' -Force | Out-Null
Set-Content -LiteralPath '%[2]s' -Value 'atime-fixture'
try {
    if (Test-Path -LiteralPath '%[4]s') { Remove-Item -LiteralPath '%[4]s' -Force }
    New-Item -ItemType SymbolicLink -Path '%[4]s' -Target '%[2]s' -Force | Out-Null
} catch {
    Write-Output ('symlink-skip: ' + $_.Exception.Message)
}
Set-ItemProperty -LiteralPath '%[2]s' -Name LastAccessTime -Value $ts -Force
Set-ItemProperty -LiteralPath '%[3]s' -Name LastAccessTime -Value $ts -Force
if (Test-Path -LiteralPath '%[4]s') {
    Set-ItemProperty -LiteralPath '%[4]s' -Name LastAccessTime -Value $ts -Force
}
`, root, filePath, dirPath, linkPath, stamp)
		script = wrapPowerShell(ps)
	default:
		return fmt.Errorf("SeedAtimeFixture: unsupported PROTOCOL_TYPE %q", PROTOCOL_TYPE)
	}

	LogDebug(fmt.Sprintf("SeedAtimeFixture script: %s", script))
	output, err := sshRunScript(sshConfig, script)
	LogDebug(fmt.Sprintf("SeedAtimeFixture output: %s", output))
	if err != nil {
		return fmt.Errorf("SeedAtimeFixture failed: %w\noutput: %s", err, output)
	}
	return nil
}
