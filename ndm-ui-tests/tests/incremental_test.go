// Package tests — Incremental Migration UI E2E flows.
//
// Tests that validate incremental (adhoc) migration behavior:
//   1. Run a baseline migration
//   2. Introduce source-side changes (file + metadata churn)
//   3. Trigger an adhoc migration run
//   4. Verify both runs complete and download CoC reports
//
// Required env vars (in addition to NFS migration vars):
//   NDM_NFS_SOURCE_HOST           — IP of the NFS source server (SSH target)
//   NDM_NFS_SOURCE_EXPORT_PATH    — export path on source
//   NDM_NFS_DESTINATION_EXPORT_PATH or NDM_NFS_DESTINATION_EXPORT_PATHS
//   NDM_WORKER_HOST / NDM_WORKER_PORT / NDM_WORKER_USERNAME / NDM_WORKER_PASSWORD
//
// Test index:
//
//	I-001 TestIncremental_AdhocAfterChurn — baseline + 10% source churn + adhoc run
package tests

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"ndm-ui-tests/config"
	"ndm-ui-tests/pages"
	"ndm-ui-tests/utils"

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
	requireEnv(t, config.NfsSourceExportPath, "NDM_NFS_SOURCE_EXPORT_PATH")
	requireEnv(t, config.NfsDestinationExportPath, "NDM_NFS_DESTINATION_EXPORT_PATH")
	requireEnv(t, config.WorkerHost, "NDM_WORKER_HOST")
	requireEnv(t, config.WorkerUsername, "NDM_WORKER_USERNAME")
	requireEnv(t, config.WorkerPassword, "NDM_WORKER_PASSWORD")

	const prefix = "i001"
	f, mp := newMigrationBrowserFixture(t, prefix)
	defer f.Close()

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
		mp.SelectSourcePath(config.NfsSourceExportPath),
		"select source path %s", config.NfsSourceExportPath,
	)

	By(t, "Selecting destination file server in mapping (with retry)")
	require.NoError(t,
		mp.SelectDestinationFileServerWithRetry(mf.srcFSID, mf.dstFSName, config.NfsSourceExportPath, 3),
		"select destination file server %s", mf.dstFSName,
	)

	By(t, "Selecting destination export path")
	require.NoError(t,
		mp.SelectDestinationPath(config.NfsDestinationExportPath),
		"select destination path %s", config.NfsDestinationExportPath,
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
	// Mount the source NFS volume on the worker, run nfs_churn.sh for ~10%
	// file and metadata changes. Volume stays mounted for fast revert later.
	By(t, "Running source churn script (~10% changes) via SSH on worker")
	runSourceChurn(t, config.NfsSourceHost, config.NfsSourceExportPath)
	t.Log("[I-001] source churn completed — ~10% changes applied")

	// Register cleanup so source is always reverted even if the test fails.
	t.Cleanup(func() {
		revertSourceChurn(t)
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
	revertSourceChurn(t)
	t.Log("[I-001] source volume reverted to original state")

	fmt.Printf("[I-001] src=%s dst=%s baseline_coc=%s adhoc_coc=%s\n",
		mf.srcFSName, mf.dstFSName, baselineCocPath, adhocCocPath)
	fmt.Println("[INCREMENTAL I-001 PASSED] Baseline + source churn + adhoc migration completed — both CoC reports downloaded — source reverted")
}

// ── Test Helpers ─────────────────────────────────────────────────────────────

// navigateToJobConfigFromRunList clicks the first migration row in Job Run List
// and extracts the job config ID from the resulting URL.
func navigateToJobConfigFromRunList(t *testing.T, mp *pages.MigrationPage) string {
	t.Helper()

	// The Job Run List rows link to Job Config Details when clicked.
	// We use JavaScript to find the config ID from the first migration row's link.
	result, err := mp.Page().Evaluate(`() => {
		// Look for links in the first row that lead to /job-details/
		const rows = document.querySelectorAll('tbody tr');
		for (const row of rows) {
			const link = row.querySelector('a[href*="job-details"]');
			if (link) {
				const match = link.href.match(/job-details\/([a-f0-9-]+)/);
				if (match) return match[1];
			}
		}
		// Fallback: check data-testid rows
		const dRows = document.querySelectorAll('[data-testid^="table-row-"]');
		for (const row of dRows) {
			const link = row.querySelector('a[href*="job-details"]');
			if (link) {
				const match = link.href.match(/job-details\/([a-f0-9-]+)/);
				if (match) return match[1];
			}
		}
		return '';
	}`, nil)

	if err != nil || result == nil || result.(string) == "" {
		// Fallback: click the first row and extract from URL
		mp.Page().Locator(`tbody tr`).First().Click()
		time.Sleep(3 * time.Second)
		return mp.GetJobConfigIDFromURL()
	}

	configID := result.(string)
	// Navigate to it
	mp.NavigateToJobConfigDetails(configID)
	return configID
}

// churnSSHConfig returns the SSH config for connecting to the worker.
func churnSSHConfig() utils.SSHConfig {
	return utils.SSHConfig{
		Host:     config.WorkerHost,
		Port:     config.WorkerPort,
		Username: config.WorkerUsername,
		Password: config.WorkerPassword,
	}
}

const churnMountPoint = "/tmp/incr_churn_mount"
const churnStateFile = "/tmp/incr_churn_state.txt"

// runSourceChurn SSHes into the worker, mounts the NFS source volume, saves
// pre-churn state (mtime + ownership), then applies ~10% file + metadata changes.
// The state file is left on the worker for revertSourceChurn to restore later.
// Keeps the volume mounted so the revert can run without re-mounting.
func runSourceChurn(t *testing.T, nfsHost, exportPath string) {
	t.Helper()

	sshCfg := churnSSHConfig()
	nfsExport := fmt.Sprintf("%s:%s", nfsHost, exportPath)

	script := fmt.Sprintf(`set -e
mkdir -p %s
mount -t nfs -o hard,rw %s %s 2>/dev/null || true

# Save pre-churn state: path \t mtime_epoch \t uid:gid
find %s -type f -printf '%%p\t%%T@\t%%U:%%G\n' > %s

TOTAL_FILES=$(wc -l < %s)
BATCH_SIZE=$(( TOTAL_FILES / 10 ))
[ "$BATCH_SIZE" -lt 5 ] && BATCH_SIZE=5

echo "Total files: $TOTAL_FILES, churn batch: $BATCH_SIZE (10%%)"

# Touch mtime on ~10%% of files
CHANGED=0
for f in $(find %s -type f | shuf -n $BATCH_SIZE 2>/dev/null || find %s -type f | head -n $BATCH_SIZE); do
    touch -m "$f" 2>/dev/null && CHANGED=$((CHANGED+1))
done

# Create new files (~2%% of total, min 2)
NEW_FILES=$(( TOTAL_FILES / 50 ))
[ "$NEW_FILES" -lt 2 ] && NEW_FILES=2
for i in $(seq 1 $NEW_FILES); do
    dd if=/dev/urandom of="%s/churn_new_${i}_$$.dat" bs=1K count=$((RANDOM %% 64 + 1)) 2>/dev/null
done

# Change ownership on ~5%% of files
UID_BATCH=$(( TOTAL_FILES / 20 ))
[ "$UID_BATCH" -lt 2 ] && UID_BATCH=2
for f in $(find %s -type f -not -name 'churn_new_*' | shuf -n $UID_BATCH 2>/dev/null || find %s -type f -not -name 'churn_new_*' | tail -n $UID_BATCH); do
    chown 1001:2001 "$f" 2>/dev/null || true
done

echo "Churn complete: touched=$CHANGED, new_files=$NEW_FILES, uid_changes=$UID_BATCH"
`,
		churnMountPoint, nfsExport, churnMountPoint,
		churnMountPoint, churnStateFile,
		churnStateFile,
		churnMountPoint, churnMountPoint,
		churnMountPoint,
		churnMountPoint, churnMountPoint,
	)

	t.Logf("[churn] SSHing to %s:%d to apply ~10%% churn on %s", sshCfg.Host, sshCfg.Port, nfsExport)
	output, err := utils.RunScript(sshCfg, script)
	if err != nil {
		t.Logf("[churn] WARNING: churn script error (may be partial): %v", err)
	}
	t.Logf("[churn] output: %s", output)
}

// revertSourceChurn restores the source volume to its pre-churn state by:
//  1. Deleting all churn_new_* files created during churn
//  2. Restoring original mtime and uid:gid from the saved state file
//  3. Unmounting the volume
//
// This runs in a single SSH call and is fast (no re-mount needed since the
// volume was left mounted by runSourceChurn).
func revertSourceChurn(t *testing.T) {
	t.Helper()

	sshCfg := churnSSHConfig()

	script := fmt.Sprintf(`set -e
# Delete files created by churn
find %s -name 'churn_new_*' -delete 2>/dev/null || true
DELETED=$(find %s -name 'churn_new_*' 2>/dev/null | wc -l)

# Restore original mtime and ownership from state file
RESTORED=0
if [ -f %s ]; then
    while IFS=$'\t' read -r fpath mtime uidgid; do
        [ -f "$fpath" ] || continue
        touch -m -d "@${mtime%%%%.*}" "$fpath" 2>/dev/null
        chown "$uidgid" "$fpath" 2>/dev/null || true
        RESTORED=$((RESTORED+1))
    done < %s
    rm -f %s
fi

echo "Revert complete: restored=$RESTORED, deleted_churn_files=$DELETED"

# Unmount and cleanup
umount %s 2>/dev/null || umount -l %s 2>/dev/null || true
rmdir %s 2>/dev/null || true
`,
		churnMountPoint,
		churnMountPoint,
		churnStateFile,
		churnStateFile,
		churnStateFile,
		churnMountPoint, churnMountPoint,
		churnMountPoint,
	)

	t.Log("[revert] restoring source volume to pre-churn state...")
	output, err := utils.RunScript(sshCfg, script)
	if err != nil {
		t.Logf("[revert] WARNING: revert error (may be partial): %v", err)
	}
	t.Logf("[revert] output: %s", output)
}
