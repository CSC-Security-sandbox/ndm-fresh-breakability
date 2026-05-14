package utils

import (
	"encoding/csv"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// VolumeScanRow holds metadata for a single file or directory collected
// from a real volume mount via stat.
type VolumeScanRow struct {
	Path        string // relative path inside the export (no leading /)
	Type        string // f=file, d=directory, l=symlink
	Size        string // bytes
	Permissions string // octal (e.g. "0644")
	UID         string
	GID         string
	AccessTime  string // epoch seconds
	ModifyTime  string // epoch seconds
	ChangeTime  string // epoch seconds
}

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

// ScanNFSVolumeForDiscovery SSHes into the worker, mounts the NFS export
// read-only, counts files/dirs/symlinks, and returns aggregate totals.
// The mount is cleaned up before returning.
func ScanNFSVolumeForDiscovery(cfg SSHConfig, nfsExport string) (*DiscoverySummary, error) {
	uid := fmt.Sprintf("%d", time.Now().UnixNano())
	mp := fmt.Sprintf("/mnt/scan_discovery_%s", uid)

	script := fmt.Sprintf(`set -e
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

	out, err := RunScript(cfg, script)
	if err != nil {
		return nil, fmt.Errorf("discovery scan failed: %w", err)
	}

	line := strings.TrimSpace(out)
	var total, files, dirs, links int
	_, err = fmt.Sscanf(line, "%d,%d,%d,%d", &total, &files, &dirs, &links)
	if err != nil {
		return nil, fmt.Errorf("parse scan output %q: %w", line, err)
	}

	return &DiscoverySummary{
		TotalCount:        total,
		RegularFilesCount: files,
		DirectoriesCount:  dirs,
		SymlinksCount:     links,
	}, nil
}

// ScanNFSVolumeForMigration SSHes into the worker, mounts the NFS export
// read-only, and collects per-file metadata (path, size, permissions,
// timestamps, checksum). Returns CSV-formatted output as rows.
func ScanNFSVolumeForMigration(cfg SSHConfig, nfsExport string) ([]VolumeScanRow, error) {
	uid := fmt.Sprintf("%d", time.Now().UnixNano())
	mp := fmt.Sprintf("/mnt/scan_migration_%s", uid)

	// %P = path relative to starting point
	// %y = type (f/d/l)
	// %s = size in bytes
	// %m = permissions in octal
	// %U = numeric UID
	// %G = numeric GID
	// %A@ = access time epoch
	// %T@ = modify time epoch
	// %C@ = change time epoch
	script := fmt.Sprintf(`set -e
sudo mkdir -p "%[1]s"
sudo mount -o ro -t nfs "%[2]s" "%[1]s"

sudo find "%[1]s" -mindepth 1 -not -path '*/.snapshot/*' \
  -printf '%%P\t%%y\t%%s\t%%m\t%%U\t%%G\t%%A@\t%%T@\t%%C@\n' | sort

sudo umount "%[1]s" || sudo umount -l "%[1]s"
sudo rm -rf "%[1]s"
`, mp, nfsExport)

	out, err := RunScript(cfg, script)
	if err != nil {
		return nil, fmt.Errorf("migration scan failed: %w", err)
	}

	var rows []VolumeScanRow
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) < 9 {
			continue
		}
		rows = append(rows, VolumeScanRow{
			Path:        fields[0],
			Type:        fields[1],
			Size:        fields[2],
			Permissions: fields[3],
			UID:         fields[4],
			GID:         fields[5],
			AccessTime:  fields[6],
			ModifyTime:  fields[7],
			ChangeTime:  fields[8],
		})
	}
	return rows, nil
}

// ScanRowsToCSV converts scan rows into CSV bytes suitable for writing
// to a file or comparing with another CSV.
func ScanRowsToCSV(rows []VolumeScanRow) (string, error) {
	var buf strings.Builder
	w := csv.NewWriter(&buf)

	header := []string{"Path", "Type", "Size", "Permissions", "UID", "GID", "AccessTime", "ModifyTime", "ChangeTime"}
	if err := w.Write(header); err != nil {
		return "", err
	}

	for _, r := range rows {
		record := []string{r.Path, r.Type, r.Size, r.Permissions, r.UID, r.GID, r.AccessTime, r.ModifyTime, r.ChangeTime}
		if err := w.Write(record); err != nil {
			return "", err
		}
	}
	w.Flush()
	return buf.String(), w.Error()
}
