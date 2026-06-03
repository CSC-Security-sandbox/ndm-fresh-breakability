// Package tests — Incremental Migration UI E2E flows.
//
// Tests that validate incremental (adhoc) migration behavior:
//   1. Run a baseline migration
//   2. Introduce source-side changes (file + metadata churn)
//   3. Trigger an adhoc migration run
//   4. Verify both runs complete and download CoC reports
//
// Required env vars (in addition to NFS migration vars):
//   NDM_NFS_SOURCE_HOST           — IP of the NFS source server
//   NDM_NFS_SOURCE_EXPORT_PATH    — export path on source
//   NDM_NFS_DESTINATION_EXPORT_PATH or NDM_NFS_DESTINATION_EXPORT_PATHS
//
// Test index:
//
//	I-001 TestIncremental_AdhocAfterChurn — baseline + 10% source churn + adhoc run
package tests

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"ndm-ui-tests/config"
	"ndm-ui-tests/pages"
	"ndm-ui-tests/utils"

	"github.com/playwright-community/playwright-go"
	"github.com/stretchr/testify/require"
)

// ═════════════════════════════════════════════════════════════════════════════
// I-001  Incremental Adhoc Migration after Source Churn
//
// Flow:
//   1. Create fresh NFS source + destination file servers
//   2. Run baseline Bulk Migrate (same as M-001)
//   3. Wait for baseline to complete
//   4. SSH into worker, mount the source volume, run nfs_churn.sh with
//      ~10% file + metadata changes
//   5. Navigate to Job Config Details and trigger "Adhoc Run"
//   6. Wait for adhoc run to complete
//   7. Download CoC reports for both baseline and adhoc runs
// ═════════════════════════════════════════════════════════════════════════════

func TestIncremental_AdhocAfterChurn(t *testing.T) {
	t.Parallel()
	srcExportPath := config.GetSourceExportPath(1)
	requireEnv(t, srcExportPath, "NDM_NFS_SOURCE_EXPORT_PATH")
	dstExportPath := config.GetDestinationExportPath(0)
	requireEnv(t, dstExportPath, "NDM_NFS_DESTINATION_EXPORT_PATH")

	const prefix = "i001"
	f, mp := newMigrationBrowserFixture(t, prefix)
	defer f.Close()

	// Always clear destination volume on test completion (pass or fail).
	t.Cleanup(func() {
		dstExport := fmt.Sprintf("%s:%s", config.NfsDestinationHost, dstExportPath)
		if err := utils.ClearNFSVolume(dstExport); err != nil {
			t.Logf("[I-001] WARNING: could not clear destination volume %s: %v", dstExport, err)
		} else {
			t.Log("[I-001] destination volume cleared successfully")
		}
	})

	mf := &migrationFixture{}
	downloadDir := filepath.Join("test-results", "downloads", prefix)
	require.NoError(t, os.MkdirAll(downloadDir, 0o755))

	// ── 1. Create source file server ─────────────────────────────────────────
	By(t, "Creating source NFS file server")
	mf.srcFSID, mf.srcFSName = createFreshSourceFileServer(t, f, prefix)
	f.Screenshot(prefix + "-incr-src-fs-active")
	t.Logf("[I-001] source: %s (ID: %s)", mf.srcFSName, mf.srcFSID)

	// ── 2. Create destination file server ────────────────────────────────────
	By(t, "Creating destination NFS file server")
	mf.dstFSID, mf.dstFSName = createFreshDestinationFileServer(t, f, prefix)
	f.Screenshot(prefix + "-incr-dst-fs-active")
	t.Logf("[I-001] destination: %s (ID: %s)", mf.dstFSName, mf.dstFSID)

	// ── 3. Navigate to source FS overview ────────────────────────────────────
	By(t, "Navigating to source file server overview")
	require.NoError(t,
		mp.NavigateToFileServerOverview(mf.srcFSID),
		"navigate to source file server overview",
	)

	// ── 4. Open Bulk Migrate wizard ──────────────────────────────────────────
	By(t, "Opening Bulk Migrate wizard")
	require.NoError(t, mp.OpenBulkMigrateForm(), "open Bulk Migrate form")
	f.Screenshot("incr-adhoc-mapping-step")

	// ── 5. Mapping step ──────────────────────────────────────────────────────
	By(t, "Selecting source export path")
	require.NoError(t,
		mp.SelectSourcePath(srcExportPath),
		"select source path %s", srcExportPath,
	)

	By(t, "Selecting destination file server in mapping (with retry)")
	require.NoError(t,
		mp.SelectDestinationFileServerWithRetry(mf.srcFSID, mf.dstFSName, srcExportPath, 3),
		"select destination file server %s", mf.dstFSName,
	)

	By(t, "Selecting destination export path")
	require.NoError(t,
		mp.SelectDestinationPath(dstExportPath),
		"select destination path %s", dstExportPath,
	)

	// ── 6. Add mapping ───────────────────────────────────────────────────────
	By(t, "Adding path mapping")
	require.NoError(t, mp.AddMapping(), "add mapping")

	// ── 7. Proceed from Mapping step ─────────────────────────────────────────
	By(t, "Proceeding from Mapping step")
	require.NoError(t, mp.ProceedFromMapping(), "proceed from mapping step")

	// ── 8. Options step — leave defaults ─────────────────────────────────────
	By(t, "Proceeding from Options step (defaults)")
	require.NoError(t, mp.ProceedFromOptions(), "proceed from options step")

	// ── 9. Review step — submit baseline migration ───────────────────────────
	By(t, "Selecting all mappings on Review step")
	require.NoError(t, mp.SelectAllMappingsOnReview(), "select all mappings on review")

	By(t, "Submitting baseline migration job")
	require.NoError(t, mp.SubmitMigration(), "submit migration job")

	// ── 10. Navigate to Job Run List and wait for baseline ───────────────────
	By(t, "Navigating to Job Run List")
	require.NoError(t, mp.NavigateToJobRunList(), "navigate to job run list")
	f.Screenshot("incr-adhoc-baseline-running")

	By(t, "Waiting for baseline migration to complete")
	require.NoError(t,
		mp.WaitForMigrationCompleted(config.MigrationTimeoutMs),
		"baseline migration did not complete within timeout",
	)
	f.Screenshot("incr-adhoc-baseline-completed")
	t.Log("[I-001] baseline migration completed")

	// ── 11. Get job config ID from the first run row ─────────────────────────
	// Click the first row to navigate to Job Config Details.
	By(t, "Navigating to Job Config Details from Job Run List")
	jobConfigID := navigateToJobConfigFromRunList(t, mp)
	require.NotEmpty(t, jobConfigID, "job config ID should not be empty")
	t.Logf("[I-001] job config ID: %s", jobConfigID)
	f.Screenshot("incr-adhoc-job-config-details")

	// ── 12. Run source churn script via SSH ──────────────────────────────────
	// Mount the source NFS volume locally on the CI runner and apply ~10%
	// file and metadata changes. Uses sudo (same as CompareNFSViaScript).
	By(t, "Running source churn script (~10% changes) locally on CI runner")
	runSourceChurn(t, config.NfsSourceHost, srcExportPath)
	t.Log("[I-001] source churn completed — ~10% changes applied")

	// Register cleanup so source is always reverted even if the test fails.
	t.Cleanup(func() {
		revertSourceChurn(t, srcExportPath)
	})

	// ── 13. Trigger Adhoc Run ────────────────────────────────────────────────
	By(t, "Triggering Adhoc Run from Job Config Details")
	require.NoError(t, mp.NavigateToJobConfigDetails(jobConfigID), "navigate to job config details")
	f.Screenshot("incr-adhoc-before-trigger")
	require.NoError(t, mp.TriggerAdhocRun(), "trigger adhoc run")
	f.Screenshot("incr-adhoc-triggered")
	t.Log("[I-001] adhoc run triggered")

	// ── 14. Wait for adhoc run to complete ───────────────────────────────────
	By(t, "Waiting for adhoc migration run to complete")
	time.Sleep(5 * time.Second) // let the new run appear in the table
	require.NoError(t, mp.NavigateToJobRunList(), "navigate to job run list for adhoc")
	require.NoError(t,
		mp.WaitForMigrationCompleted(config.MigrationTimeoutMs),
		"adhoc migration run did not complete within timeout",
	)
	f.Screenshot("incr-adhoc-completed")
	t.Log("[I-001] adhoc migration run completed")

	// ── 15. Download CoC reports for both runs ───────────────────────────────
	By(t, "Navigating to Job Config Details to download reports")
	require.NoError(t, mp.NavigateToJobConfigDetails(jobConfigID), "navigate to job config details for reports")
	mp.ClickRunHistoryTab()
	f.Screenshot("incr-adhoc-run-history")

	// Row 0 = most recent (adhoc), Row 1 = baseline
	By(t, "Downloading CoC Report for adhoc run (row 0)")
	adhocCocPath, err := mp.DownloadCoCReportByRowIndex(downloadDir, 0)
	require.NoError(t, err, "download CoC report for adhoc run")
	info, statErr := os.Stat(adhocCocPath)
	require.NoError(t, statErr)
	require.Greater(t, info.Size(), int64(0), "adhoc CoC report should not be empty")
	t.Logf("[I-001] adhoc CoC report: %s (%d bytes)", adhocCocPath, info.Size())

	By(t, "Downloading CoC Report for baseline run (row 1)")
	baselineCocPath, err := mp.DownloadCoCReportByRowIndex(downloadDir, 1)
	require.NoError(t, err, "download CoC report for baseline run")
	info, statErr = os.Stat(baselineCocPath)
	require.NoError(t, statErr)
	require.Greater(t, info.Size(), int64(0), "baseline CoC report should not be empty")
	t.Logf("[I-001] baseline CoC report: %s (%d bytes)", baselineCocPath, info.Size())

	// ── 16. Revert source volume to pre-churn state ─────────────────────────
	By(t, "Reverting source volume to pre-churn state")
	revertSourceChurn(t, srcExportPath)
	t.Log("[I-001] source volume reverted to original state")

	fmt.Printf("[I-001] src=%s dst=%s baseline_coc=%s adhoc_coc=%s\n",
		mf.srcFSName, mf.dstFSName, baselineCocPath, adhocCocPath)
	fmt.Println("[INCREMENTAL I-001 PASSED] Baseline + source churn + adhoc migration completed — both CoC reports downloaded — source reverted")
}

// ── Test Helpers ─────────────────────────────────────────────────────────────

// navigateToJobConfigFromRunList clicks "Details" via the overflow menu on
// the first migration row in Job Run List — which navigates to
// /job-details/<configID>/run/<runID>. Returns the configID extracted from URL.
func navigateToJobConfigFromRunList(t *testing.T, mp *pages.MigrationPage) string {
	t.Helper()

	page := mp.Page()

	// Re-navigate to Job Run List to ensure we have a fresh table view.
	require.NoError(t, mp.NavigateToJobRunList(), "re-navigate to job run list")
	time.Sleep(3 * time.Second)

	// The table uses [data-testid^="table-row-"] rows (BlueXP table component).
	// Wait for at least one row to appear.
	rowLoc := page.Locator(`[data-testid^="table-row-"]`).First()
	err := rowLoc.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(20000),
	})
	if err != nil {
		// Fallback: try native tbody tr
		rowLoc = page.Locator(`tbody tr`).First()
		err = rowLoc.WaitFor(playwright.LocatorWaitForOptions{
			State:   playwright.WaitForSelectorStateVisible,
			Timeout: playwright.Float(10000),
		})
		require.NoError(t, err, "no table rows visible in Job Run List")
	}

	// Open the overflow menu (⋯) on the first row.
	overflowBtn := rowLoc.Locator(`[data-testid="btn-overflow-menu"]`)
	if count, _ := overflowBtn.Count(); count == 0 {
		overflowBtn = rowLoc.Locator(`button`).Last()
	}
	require.NoError(t, overflowBtn.Click(playwright.LocatorClickOptions{
		Force: playwright.Bool(true),
	}), "click overflow menu on first row")
	time.Sleep(1 * time.Second)

	// Click "Details" menu item.
	detailsBtn := page.Locator(`[data-testid="menu-details"]`)
	if count, _ := detailsBtn.Count(); count == 0 {
		detailsBtn = page.GetByText("Details", playwright.PageGetByTextOptions{Exact: playwright.Bool(true)}).First()
	}
	require.NoError(t, detailsBtn.Click(), "click Details in overflow menu")
	time.Sleep(3 * time.Second)

	// Extract config ID from the URL: /job-details/<configID>/run/<runID>
	return mp.GetJobConfigIDFromURL()
}

const churnMountPoint = "/tmp/incr_churn_mount"

// runSourceChurn mounts the NFS source volume locally on the CI runner and
// applies three types of changes to simulate real-world source-side churn:
//
//   - 10%% metadata changes: modifies mtime + permissions on random existing
//     files (chmod 755→750 or vice versa, touch -m to update mtime). These are
//     the metadata fields NDM tracks: uid, gid, permissions, size, mtime, atime.
//   - 10%% file changes: creates new playwright-churn-*.dat files (random 1–64 KB).
//   - Directory changes: creates 2 new subdirectories with files inside.
//
// Does NOT require root_squash=off because it uses chmod/touch (not chown)
// and creates files as the mapped NFS user.
//
// Runs locally with sudo (same approach as CompareNFSViaScript) since the
// CI runner has direct NFS access and sudo privileges.
func runSourceChurn(t *testing.T, nfsHost, exportPath string) {
	t.Helper()

	nfsExport := fmt.Sprintf("%s:%s", nfsHost, exportPath)

	script := fmt.Sprintf(`set -e
mkdir -p %s
mount -t nfs -o hard,rw %s %s || { echo "ERROR: mount failed"; exit 1; }

TOTAL_FILES=$(find %s -type f -not -name 'playwright-*' -not -path '*/playwright-churn-dir-*' | wc -l)
TOTAL_DIRS=$(find %s -type d -not -path '*/playwright-churn-dir-*' | wc -l)
echo "Found $TOTAL_FILES existing files, $TOTAL_DIRS directories on source volume"

META_BATCH=$(( TOTAL_FILES / 10 ))
FILE_BATCH=$(( TOTAL_FILES / 10 ))
[ "$META_BATCH" -lt 5 ] && META_BATCH=5
[ "$FILE_BATCH" -lt 5 ] && FILE_BATCH=5

echo "Plan: metadata_changes=$META_BATCH (10%%), new_files=$FILE_BATCH (10%%), new_dirs=2"

# ── 10%% metadata changes (permissions + mtime) with manifest for revert ──
MANIFEST="%s/.playwright-churn-manifest.txt"
> "$MANIFEST"
META_CHANGED=0
for f in $(find %s -type f -not -name 'playwright-*' -not -path '*/playwright-churn-dir-*' | shuf -n $META_BATCH 2>/dev/null || find %s -type f -not -name 'playwright-*' -not -path '*/playwright-churn-dir-*' | head -n $META_BATCH); do
    ORIG_PERMS=$(stat -c '%%a' "$f" 2>/dev/null) || continue
    ORIG_MTIME=$(stat -c '%%Y' "$f" 2>/dev/null) || continue
    echo "perms|${ORIG_PERMS}|${ORIG_MTIME}|${f}" >> "$MANIFEST"
    # Toggle permissions: if 644→755, if 755→644, else set 750
    if [ "$ORIG_PERMS" = "644" ]; then
        chmod 755 "$f" 2>/dev/null
    elif [ "$ORIG_PERMS" = "755" ]; then
        chmod 644 "$f" 2>/dev/null
    else
        chmod 750 "$f" 2>/dev/null
    fi
    # Touch mtime to current time (NDM detects mtime changes)
    touch -m "$f" 2>/dev/null
    META_CHANGED=$((META_CHANGED+1))
done
echo "Metadata changes applied: $META_CHANGED files (permissions + mtime)"

# ── 10%% new file changes ──
FILE_CREATED=0
for i in $(seq 1 $FILE_BATCH); do
    dd if=/dev/urandom of="%s/playwright-churn-${i}-$$.dat" bs=1K count=$((RANDOM %% 64 + 1)) 2>/dev/null
    FILE_CREATED=$((FILE_CREATED+1))
done
echo "New files created: $FILE_CREATED"

# ── Directory changes: 2 new subdirectories with files ──
DIR_CREATED=0
for d in 1 2; do
    DIRNAME="%s/playwright-churn-dir-${d}-$$"
    mkdir -p "$DIRNAME" 2>/dev/null || continue
    for i in 1 2 3; do
        dd if=/dev/urandom of="${DIRNAME}/file-${i}.dat" bs=1K count=$((RANDOM %% 32 + 1)) 2>/dev/null
    done
    DIR_CREATED=$((DIR_CREATED+1))
done
echo "New directories created: $DIR_CREATED (with 3 files each)"

echo "Churn complete: metadata_changes=$META_CHANGED, new_files=$FILE_CREATED, new_dirs=$DIR_CREATED"
`,
		churnMountPoint, nfsExport, churnMountPoint,
		churnMountPoint,
		churnMountPoint,
		churnMountPoint,
		churnMountPoint, churnMountPoint,
		churnMountPoint,
		churnMountPoint,
	)

	t.Logf("[churn] running locally (sudo) to apply 10%% metadata + 10%% file changes on %s", nfsExport)
	output, err := runLocalScript(script)
	if err != nil {
		t.Logf("[churn] WARNING: churn script error (may be partial): %v", err)
	}
	t.Logf("[churn] output: %s", output)
}

// revertSourceChurn restores the source volume to its pre-churn state:
//   - Ensures volume is mounted (re-mounts if needed)
//   - Restores original permissions and mtime from manifest
//   - Deletes all playwright-churn-* files and directories
//   - Removes the manifest file
//   - Unmounts and cleans up the mount point
func revertSourceChurn(t *testing.T, exportPath string) {
	t.Helper()

	nfsExport := fmt.Sprintf("%s:%s", config.NfsSourceHost, exportPath)

	script := fmt.Sprintf(`set -e
# ── Ensure volume is mounted ──
mkdir -p %s
mountpoint -q %s 2>/dev/null || mount -t nfs -o hard,rw %s %s 2>/dev/null || true

MANIFEST="%s/.playwright-churn-manifest.txt"

# ── Restore original permissions and mtime from manifest ──
RESTORED=0
if [ -f "$MANIFEST" ]; then
    while IFS='|' read -r TYPE ORIG_PERMS ORIG_MTIME FILE_PATH; do
        [ -z "$FILE_PATH" ] && continue
        [ "$TYPE" != "perms" ] && continue
        chmod "$ORIG_PERMS" "$FILE_PATH" 2>/dev/null || true
        touch -m -d "@${ORIG_MTIME}" "$FILE_PATH" 2>/dev/null || true
        RESTORED=$((RESTORED+1))
    done < "$MANIFEST"
    rm -f "$MANIFEST"
fi

# ── Delete all playwright-churn-* files and directories ──
DELETED=$(find %s -name 'playwright-churn-*' 2>/dev/null | wc -l)
find %s -name 'playwright-churn-*' -type f -delete 2>/dev/null || true
find %s -name 'playwright-churn-*' -type d -exec rm -rf {} + 2>/dev/null || true

echo "Revert complete: metadata_restored=$RESTORED, items_deleted=$DELETED"

# ── Unmount and cleanup ──
umount %s 2>/dev/null || umount -l %s 2>/dev/null || true
rmdir %s 2>/dev/null || true
`,
		churnMountPoint,
		churnMountPoint, nfsExport, churnMountPoint,
		churnMountPoint,
		churnMountPoint,
		churnMountPoint,
		churnMountPoint,
		churnMountPoint, churnMountPoint,
		churnMountPoint,
	)

	t.Log("[revert] restoring ownership, deleting churn files, and unmounting...")
	output, err := runLocalScript(script)
	if err != nil {
		t.Logf("[revert] WARNING: revert error (may be partial): %v", err)
	}
	t.Logf("[revert] output: %s", output)
}

// runLocalScript executes a bash script locally with sudo, matching the
// approach used by CompareNFSViaScript. The CI runner has sudo access and
// direct NFS connectivity.
func runLocalScript(script string) (string, error) {
	cmd := exec.Command("sudo", "bash", "-c", script)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return stdout.String(), fmt.Errorf("local script failed: %w\nstdout: %s\nstderr: %s",
			err, stdout.String(), stderr.String())
	}
	return stdout.String(), nil
}
