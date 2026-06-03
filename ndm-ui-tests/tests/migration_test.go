// Package tests — Migration UI E2E flows.
//
// Each test creates FRESH source and destination file servers via the wizard,
// then runs the full Bulk Migrate flow end-to-end.
//
// Required .env vars:
//   NDM_NFS_SOURCE_HOST                        — IP of the NFS source server
//   NDM_NFS_SOURCE_EXPORT_PATH                 — export path on the source (e.g. "/dest-dm")
//   NDM_NFS_SOURCE_FILE_SERVER_NAME_PREFIX      — name prefix for source FS
//   NDM_NFS_DESTINATION_HOST                   — IP of the NFS destination server
//   NDM_NFS_DESTINATION_EXPORT_PATH            — export path on the destination
//   NDM_NFS_DESTINATION_FILE_SERVER_NAME_PREFIX — name prefix for destination FS
//   NDM_NFS_PROTOCOL_USERNAME                  — NFS username (default: "root")
//   NDM_NFS_PROTOCOL_PASSWORD                  — NFS password (default: "")
//   NDM_MIGRATION_TIMEOUT_MS                   — max wait for job (default: 600000)
//
// Test index:
//
//	M-001 TestMigration_BasicNFS                      — full Bulk Migrate flow (NFS → NFS)
//	M-002 TestMigration_IncrementalSyncCron           — Bulk Migrate with cron-based incremental sync
//	M-003 TestMigration_CustomOptions                 — Bulk Migrate with all config options changed
//	M-005 TestMigration_JobConfigSummaryConsistency   — Summary of Last Run matches Run History table
package tests

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ndm-ui-tests/config"
	"ndm-ui-tests/fixtures"
	"ndm-ui-tests/pages"
	"ndm-ui-tests/utils"

	"github.com/stretchr/testify/require"
)

// migrationFixture holds file server IDs shared across migration steps.
type migrationFixture struct {
	srcFSID   string
	srcFSName string
	dstFSID   string
	dstFSName string
}

// newMigrationBrowserFixture creates the auth fixture and both page objects
// needed for the migration flow. The prefix is used to namespace screenshots
// so parallel tests don't overwrite each other's images.
func newMigrationBrowserFixture(t *testing.T, prefix string) (*fixtures.AuthFixture, *pages.MigrationPage) {
	t.Helper()
	f := fixtures.NewAdminFixture(t)

	if utils.SetupProjectName != "" {
		require.NoError(t,
			pages.SwitchToProject(f.Page, utils.SetupProjectName),
			"switch to setup project %s", utils.SetupProjectName,
		)
		t.Logf("[%s] switched to setup project %s", prefix, utils.SetupProjectName)
	}

	mp := pages.NewMigrationPage(f.Page, prefix)
	return f, mp
}

// createFreshSourceFileServer creates a new NFS source file server named
// <NDM_NFS_SOURCE_FILE_SERVER_NAME_PREFIX>-<timestamp>, attaches a worker,
// and waits until Active.
func createFreshSourceFileServer(t *testing.T, f *fixtures.AuthFixture, prefix string) (fsID string, fsName string) {
	t.Helper()
	requireEnv(t, config.NfsSourceHost, "NDM_NFS_SOURCE_HOST")

	fsName = fmt.Sprintf("%s-%d", config.NfsSourceFileServerNamePrefix, time.Now().UnixMilli())
	t.Logf("[setup] creating source file server %q on host %s", fsName, config.NfsSourceHost)

	fsp := pages.NewFileServerPage(f.Page, prefix)
	var err error
	fsID, err = fsp.CreateNFSFileServer(
		fsName,
		config.NfsSourceHost,
		config.NfsSourceProtocolUsername,
		config.NfsSourceProtocolPassword,
		config.MinWorkers,
	)
	require.NoError(t, err, "create NFS source file server via wizard")
	t.Logf("[setup] source file server %s (ID: %s) created — waiting for Active…", fsName, fsID)

	require.NoError(t,
		fsp.WaitForFileServerActive(fsID, 300000),
		"source file server did not become active within 5 minutes",
	)
	t.Logf("[setup] source file server %s is now Active", fsName)
	return fsID, fsName
}

// createFreshDestinationFileServer creates a new NFS destination file server
// named <NDM_NFS_DESTINATION_FILE_SERVER_NAME_PREFIX>-<timestamp>, attaches
// a worker, and waits until Active.
func createFreshDestinationFileServer(t *testing.T, f *fixtures.AuthFixture, prefix string) (fsID string, fsName string) {
	t.Helper()
	requireEnv(t, config.NfsDestinationHost, "NDM_NFS_DESTINATION_HOST")

	fsName = fmt.Sprintf("%s-%d", config.NfsDestinationFileServerNamePrefix, time.Now().UnixMilli())
	t.Logf("[setup] creating destination file server %q on host %s", fsName, config.NfsDestinationHost)

	fsp := pages.NewFileServerPage(f.Page, prefix)
	var err error
	fsID, err = fsp.CreateNFSFileServer(
		fsName,
		config.NfsDestinationHost,
		config.NfsDestinationProtocolUsername,
		config.NfsDestinationProtocolPassword,
		config.MinWorkers,
	)
	require.NoError(t, err, "create NFS destination file server via wizard")
	t.Logf("[setup] destination file server %s (ID: %s) created — waiting for Active…", fsName, fsID)

	require.NoError(t,
		fsp.WaitForFileServerActive(fsID, 300000),
		"destination file server did not become ready for migration within 5 minutes",
	)
	t.Logf("[setup] destination file server %s is now Active", fsName)
	return fsID, fsName
}

// ═════════════════════════════════════════════════════════════════════════════
// M-001  Basic NFS Migration (source → destination)
// ═════════════════════════════════════════════════════════════════════════════

func TestMigration_BasicNFS(t *testing.T) {
	t.Parallel()
	srcExportPath := config.GetSourceExportPath(0)
	requireEnv(t, srcExportPath, "NDM_NFS_SOURCE_EXPORT_PATH")
	dstExportPath := config.GetDestinationExportPath(0)
	requireEnv(t, dstExportPath, "NDM_NFS_DESTINATION_EXPORT_PATH")

	const prefix = "m001"
	f, mp := newMigrationBrowserFixture(t, prefix)
	defer f.Close()

	// Always clear destination volume on test completion (pass or fail).
	t.Cleanup(func() {
		dstExport := fmt.Sprintf("%s:%s", config.NfsDestinationHost, dstExportPath)
		if err := utils.ClearNFSVolume(dstExport); err != nil {
			t.Logf("[M-001] WARNING: could not clear destination volume %s: %v", dstExport, err)
		} else {
			t.Log("[M-001] destination volume cleared successfully")
		}
	})

	mf := &migrationFixture{}

	// ── 1. Create source file server ─────────────────────────────────────────
	By(t, "Creating source NFS file server")
	mf.srcFSID, mf.srcFSName = createFreshSourceFileServer(t, f, prefix)
	f.Screenshot(prefix + "-mig-src-fs-active")
	t.Logf("[M-001] source: %s (ID: %s)", mf.srcFSName, mf.srcFSID)

	// ── 2. Create destination file server ────────────────────────────────────
	By(t, "Creating destination NFS file server")
	mf.dstFSID, mf.dstFSName = createFreshDestinationFileServer(t, f, prefix)
	f.Screenshot(prefix + "-mig-dst-fs-active")
	t.Logf("[M-001] destination: %s (ID: %s)", mf.dstFSName, mf.dstFSID)

	// ── 3. Navigate to source file server overview ───────────────────────────
	By(t, "Navigating to source file server overview")
	require.NoError(t,
		mp.NavigateToFileServerOverview(mf.srcFSID),
		"navigate to source file server overview",
	)
	f.Screenshot("mig-src-overview")

	// ── 4. Open Bulk Migrate wizard ──────────────────────────────────────────
	By(t, "Opening Bulk Migrate wizard")
	require.NoError(t, mp.OpenBulkMigrateForm(), "open Bulk Migrate form")
	f.Screenshot("mig-wizard-mapping-step")

	// ── 5. Mapping step ───────────────────────────────────────────────────────
	// Order matters: source path must be selected before destination FS
	// (destination FS dropdown is enabled regardless, but destination path
	// dropdown only loads after a destination FS is chosen).

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
	f.Screenshot("mig-mapping-row-added")

	// ── 7. Proceed from Mapping step ─────────────────────────────────────────
	By(t, "Proceeding from Mapping step")
	require.NoError(t, mp.ProceedFromMapping(), "proceed from mapping step")
	f.Screenshot("mig-options-step")

	// ── 8. Options step — leave defaults, proceed ────────────────────────────
	By(t, "Proceeding from Options step (defaults)")
	require.NoError(t, mp.ProceedFromOptions(), "proceed from options step")
	f.Screenshot("mig-review-step")

	// ── 9. Review step — select all mappings, submit ─────────────────────────
	By(t, "Selecting all mappings on Review step")
	require.NoError(t, mp.SelectAllMappingsOnReview(), "select all mappings on review")

	By(t, "Submitting migration job")
	require.NoError(t, mp.SubmitMigration(), "submit migration job")

	// ── 10. Navigate to Job Run List ─────────────────────────────────────────
	By(t, "Navigating to Job Run List")
	require.NoError(t, mp.NavigateToJobRunList(), "navigate to job run list")
	f.Screenshot("mig-job-run-list")

	// ── 10a. Capture the Job Run ID for later use ────────────────────────────
	jobRunID := mp.GetLatestJobRunID()
	t.Logf("[M-001] captured job run ID: %s", jobRunID)

	// ── 11. Wait for migration job to complete ───────────────────────────────
	By(t, "Waiting for migration job to complete")
	require.NoError(t,
		mp.WaitForMigrationCompleted(config.MigrationTimeoutMs),
		"migration job did not complete within timeout",
	)
	f.Screenshot("mig-job-completed")
	t.Log("[M-001] migration job completed successfully")

	// ── 12. Download CoC Report (search by Job Run ID) ───────────────────────
	By(t, "Downloading CoC Report")
	downloadDir := filepath.Join("test-results", "downloads")
	require.NoError(t, os.MkdirAll(downloadDir, 0o755))

	cocPath, err := mp.DownloadCoCReport(downloadDir, jobRunID)
	require.NoError(t, err, "download CoC report")

	info, statErr := os.Stat(cocPath)
	require.NoError(t, statErr, "CoC report file should exist at %s", cocPath)
	require.Greater(t, info.Size(), int64(0), "CoC report should not be empty")

	t.Logf("[M-001] CoC Report saved: %s (%d bytes)", cocPath, info.Size())
	fmt.Printf("[M-001] src=%s dst=%s coc=%s\n", mf.srcFSName, mf.dstFSName, cocPath)
	fmt.Println("[MIGRATION M-001 PASSED] NFS migration completed and CoC Report downloaded")

	// ── 13. Validate CoC Report against live NFS volumes ─────────────────────
	By(t, "Validating CoC Report against live NFS volumes")
	srcExport := fmt.Sprintf("%s:%s", config.NfsSourceHost, srcExportPath)
	dstExport := fmt.Sprintf("%s:%s", config.NfsDestinationHost, dstExportPath)

	result, valErr := utils.ValidateReport(
		utils.ReportTypeMigration,
		utils.ProtocolNFS,
		cocPath,
		srcExport,
		dstExport,
	)
	require.NoError(t, valErr, "CoC report validation failed")
	require.True(t, result.Match,
		"[M-001] CoC report does not match live volumes:\n%s", result.String())

	t.Log("[M-001] CoC Report validated successfully against live NFS volumes")
	fmt.Println("[MIGRATION M-001 VALIDATED] CoC Report matches live NFS source and destination")

	// ── 13b. Static checksum validation (known files with pre-computed hashes) ──
	By(t, "Validating static file checksums against CoC report")
	specPath := filepath.Join("validators", "nfs_migration_checksums.json")
	if _, statErr := os.Stat(specPath); statErr == nil {
		staticResult, staticErr := utils.ValidateCoCStaticChecksums(cocPath, specPath)
		require.NoError(t, staticErr, "static checksum validation failed")
		require.True(t, staticResult.Match,
			"[M-001] static checksum mismatch:\n%s", staticResult.String())
		t.Log("[M-001] static checksum validation PASSED")
	} else {
		t.Log("[M-001] no static checksum spec found — skipping")
	}

	// ── 14. Direct src ↔ dst metadata comparison via nfs_metadata_compare.sh ──
	// Runs the shell script on the Linux worker (parallel workers = fast).
	// Checks uid, gid, permissions, size, mtime, atime directly between
	// the source and destination volumes — independent of the CoC report.
	By(t, "Comparing source and destination NFS metadata via script")
	scriptResult, scriptErr := utils.CompareNFSViaScript(srcExport, dstExport, 8, true)
	require.NoError(t, scriptErr, "NFS metadata script comparison failed")
	if scriptResult.HasDiffs {
		// Write diffs to a TSV file for artifact upload and later inspection.
		diffsDir := filepath.Join("test-results", "downloads")
		_ = os.MkdirAll(diffsDir, 0o755)
		diffsFile := filepath.Join(diffsDir, fmt.Sprintf("nfs_comparison_diffs_%d.tsv", time.Now().Unix()))
		writeDiffsTSV(diffsFile, scriptResult.Discrepancies, srcExport, dstExport)
		t.Logf("[M-001] diffs written to %s", diffsFile)

		var diffs []string
		for _, d := range scriptResult.Discrepancies {
			diffs = append(diffs, fmt.Sprintf("path=%s field=%s src=%q dst=%q",
				d.Path, d.Field, d.SrcValue, d.DstValue))
		}
		require.Fail(t,
			fmt.Sprintf("[M-001] direct src↔dst metadata mismatch (%d diff(s)), see %s:\n  %s",
				len(scriptResult.Discrepancies), diffsFile, strings.Join(diffs, "\n  ")))
	}
	t.Logf("[M-001] direct metadata comparison PASSED: %s", scriptResult.Summary())
}

// ═════════════════════════════════════════════════════════════════════════════
// M-002  Incremental Sync via Cron Expression (NFS → NFS)
// ═════════════════════════════════════════════════════════════════════════════

func TestMigration_IncrementalSyncCron(t *testing.T) {
	t.Parallel()
	time.Sleep(5 * time.Second) // stagger parallel start to reduce NDM backend contention
	srcExportPath := config.GetSourceExportPath(0)
	requireEnv(t, srcExportPath, "NDM_NFS_SOURCE_EXPORT_PATH")
	dstExportPath := config.GetDestinationExportPath(1)
	requireEnv(t, dstExportPath, "NDM_NFS_DESTINATION_EXPORT_PATH")

	const prefix = "m002"
	f, mp := newMigrationBrowserFixture(t, prefix)
	defer f.Close()

	// Always clear destination volume on test completion (pass or fail).
	t.Cleanup(func() {
		dstExport := fmt.Sprintf("%s:%s", config.NfsDestinationHost, dstExportPath)
		if err := utils.ClearNFSVolume(dstExport); err != nil {
			t.Logf("[M-002] WARNING: could not clear destination volume %s: %v", dstExport, err)
		} else {
			t.Log("[M-002] destination volume cleared successfully")
		}
	})

	mf := &migrationFixture{}

	// ── 1. Create source file server ─────────────────────────────────────────
	By(t, "Creating source NFS file server")
	mf.srcFSID, mf.srcFSName = createFreshSourceFileServer(t, f, prefix)
	f.Screenshot(prefix + "-incr-src-fs-active")
	t.Logf("[M-002] source: %s (ID: %s)", mf.srcFSName, mf.srcFSID)

	// ── 2. Create destination file server ────────────────────────────────────
	By(t, "Creating destination NFS file server")
	mf.dstFSID, mf.dstFSName = createFreshDestinationFileServer(t, f, prefix)
	f.Screenshot(prefix + "-incr-dst-fs-active")
	t.Logf("[M-002] destination: %s (ID: %s)", mf.dstFSName, mf.dstFSID)

	// ── 3. Navigate to source file server overview ───────────────────────────
	By(t, "Navigating to source file server overview")
	require.NoError(t,
		mp.NavigateToFileServerOverview(mf.srcFSID),
		"navigate to source file server overview",
	)
	f.Screenshot("incr-src-overview")

	// ── 4. Open Bulk Migrate wizard ──────────────────────────────────────────
	By(t, "Opening Bulk Migrate wizard")
	require.NoError(t, mp.OpenBulkMigrateForm(), "open Bulk Migrate form")
	f.Screenshot("incr-wizard-mapping-step")

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

	By(t, "Adding path mapping")
	require.NoError(t, mp.AddMapping(), "add mapping")
	f.Screenshot("incr-mapping-row-added")

	// ── 6. Proceed from Mapping step ─────────────────────────────────────────
	By(t, "Proceeding from Mapping step")
	require.NoError(t, mp.ProceedFromMapping(), "proceed from mapping step")
	f.Screenshot("incr-options-step")

	// ── 7. Options step — set cron expression to every 5 minutes ─────────────
	By(t, "Setting incremental sync cron expression to */5 * * * *")
	require.NoError(t,
		mp.SetIncrementalSyncCronExpression("*/5 * * * *"),
		"set cron expression",
	)
	f.Screenshot("incr-options-cron-set")

	By(t, "Proceeding from Options step")
	require.NoError(t, mp.ProceedFromOptions(), "proceed from options step")
	f.Screenshot("incr-review-step")

	// ── 8. Review step — select all, submit ──────────────────────────────────
	By(t, "Selecting all mappings on Review step")
	require.NoError(t, mp.SelectAllMappingsOnReview(), "select all mappings on review")

	By(t, "Submitting migration job")
	require.NoError(t, mp.SubmitMigration(), "submit migration job")

	// ── 9. Navigate to Job Run List ──────────────────────────────────────────
	By(t, "Navigating to Job Run List")
	require.NoError(t, mp.NavigateToJobRunList(), "navigate to job run list")
	f.Screenshot("incr-job-run-list")

	// ── 10. Wait for first migration job to complete ─────────────────────────
	By(t, "Waiting for first migration job to complete")
	require.NoError(t,
		mp.WaitForMigrationCompleted(config.MigrationTimeoutMs),
		"first migration job did not complete within timeout",
	)
	f.Screenshot("incr-first-job-completed")
	t.Log("[M-002] first migration job completed")

	// Count migration rows after first job completes.
	initialCount := mp.CountMigrationJobRuns()
	t.Logf("[M-002] migration rows after first job: %d", initialCount)

	// ── 11. Wait for incremental sync job to appear and complete ─────────────
	// Cron is */5 * * * * so a new job should appear within ~5-6 minutes.
	By(t, "Waiting for incremental sync job (cron: */5 * * * *)")
	t.Log("[M-002] waiting up to 8 minutes for incremental sync job to appear and complete…")
	require.NoError(t,
		mp.WaitForNewMigrationJobRun(initialCount, 480000),
		"incremental sync job did not appear/complete within 8 minutes",
	)
	f.Screenshot("incr-sync-job-completed")
	t.Log("[M-002] incremental sync job completed successfully")

	finalCount := mp.CountMigrationJobRuns()
	t.Logf("[M-002] migration rows after incremental sync: %d (was %d)", finalCount, initialCount)
	require.Greater(t, finalCount, initialCount,
		"expected more migration job runs after incremental sync (got %d, started with %d)", finalCount, initialCount,
	)

	fmt.Printf("[M-002] src=%s dst=%s cron=*/5 initial_jobs=%d final_jobs=%d\n",
		mf.srcFSName, mf.dstFSName, initialCount, finalCount)
	fmt.Println("[MIGRATION M-002 PASSED] Incremental sync via cron expression verified")
}

// ═════════════════════════════════════════════════════════════════════════════
// M-003  Custom Migration Options (NFS → NFS)
//
// Modifies ALL configurable options on the Options step before submitting:
//   - Preserve a-time     → OFF
//   - Preserve Permissions → OFF
//   - Migrate File        → "Exclude file older than (UTC)"
//   - Skip Files modified  → 30  (default unit)
//   - Excluded Path Patterns → "*.tmp\n*.log"
//
// After migration completes, downloads the CoC Report.
// ═════════════════════════════════════════════════════════════════════════════

func TestMigration_CustomOptions(t *testing.T) {
	t.Parallel()
	time.Sleep(10 * time.Second) // stagger parallel start to reduce NDM backend contention
	srcExportPath := config.GetSourceExportPath(0)
	requireEnv(t, srcExportPath, "NDM_NFS_SOURCE_EXPORT_PATH")
	dstExportPath := config.GetDestinationExportPath(2)
	requireEnv(t, dstExportPath, "NDM_NFS_DESTINATION_EXPORT_PATH")

	const prefix = "m003"
	f, mp := newMigrationBrowserFixture(t, prefix)
	defer f.Close()

	// Always clear destination volume on test completion (pass or fail).
	t.Cleanup(func() {
		dstExport := fmt.Sprintf("%s:%s", config.NfsDestinationHost, dstExportPath)
		if err := utils.ClearNFSVolume(dstExport); err != nil {
			t.Logf("[M-003] WARNING: could not clear destination volume %s: %v", dstExport, err)
		} else {
			t.Log("[M-003] destination volume cleared successfully")
		}
	})

	mf := &migrationFixture{}

	// ── 1. Create source file server ─────────────────────────────────────────
	By(t, "Creating source NFS file server")
	mf.srcFSID, mf.srcFSName = createFreshSourceFileServer(t, f, prefix)
	f.Screenshot(prefix + "-opts-src-fs-active")
	t.Logf("[M-003] source: %s (ID: %s)", mf.srcFSName, mf.srcFSID)

	// ── 2. Create destination file server ────────────────────────────────────
	By(t, "Creating destination NFS file server")
	mf.dstFSID, mf.dstFSName = createFreshDestinationFileServer(t, f, prefix)
	f.Screenshot(prefix + "-opts-dst-fs-active")
	t.Logf("[M-003] destination: %s (ID: %s)", mf.dstFSName, mf.dstFSID)

	// ── 3. Navigate to source file server overview ───────────────────────────
	By(t, "Navigating to source file server overview")
	require.NoError(t,
		mp.NavigateToFileServerOverview(mf.srcFSID),
		"navigate to source file server overview",
	)
	f.Screenshot("opts-src-overview")

	// ── 4. Open Bulk Migrate wizard ──────────────────────────────────────────
	By(t, "Opening Bulk Migrate wizard")
	require.NoError(t, mp.OpenBulkMigrateForm(), "open Bulk Migrate form")
	f.Screenshot("opts-wizard-mapping-step")

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

	By(t, "Adding path mapping")
	require.NoError(t, mp.AddMapping(), "add mapping")
	f.Screenshot("opts-mapping-row-added")

	// ── 6. Proceed from Mapping step ─────────────────────────────────────────
	By(t, "Proceeding from Mapping step")
	require.NoError(t, mp.ProceedFromMapping(), "proceed from mapping step")
	f.Screenshot("opts-options-step")

	// ── 7. Options step — change all config fields ───────────────────────────
	By(t, "Configuring custom migration options")
	require.NoError(t,
		mp.ConfigureCustomOptions("30", "*.tmp\n*.log"),
		"configure custom migration options",
	)
	f.Screenshot("opts-options-configured")

	By(t, "Proceeding from Options step")
	require.NoError(t, mp.ProceedFromOptions(), "proceed from options step")
	f.Screenshot("opts-review-step")

	// ── 8. Review step — select all mappings, submit ─────────────────────────
	By(t, "Selecting all mappings on Review step")
	require.NoError(t, mp.SelectAllMappingsOnReview(), "select all mappings on review")

	By(t, "Submitting migration job")
	require.NoError(t, mp.SubmitMigration(), "submit migration job")

	// ── 9. Navigate to Job Run List ──────────────────────────────────────────
	By(t, "Navigating to Job Run List")
	require.NoError(t, mp.NavigateToJobRunList(), "navigate to job run list")
	f.Screenshot("opts-job-run-list")

	// ── 10. Wait for migration job to complete ───────────────────────────────
	By(t, "Waiting for migration job to complete")
	require.NoError(t,
		mp.WaitForMigrationCompleted(config.MigrationTimeoutMs),
		"migration job did not complete within timeout",
	)
	f.Screenshot("opts-job-completed")
	t.Log("[M-003] migration job completed successfully")

	// ── 11. Download CoC Report ──────────────────────────────────────────────
	By(t, "Downloading CoC Report")
	downloadDir := filepath.Join("test-results", "downloads")
	require.NoError(t, os.MkdirAll(downloadDir, 0o755))

	cocPath, err := mp.DownloadCoCReport(downloadDir)
	require.NoError(t, err, "download CoC report")

	info, statErr := os.Stat(cocPath)
	require.NoError(t, statErr, "CoC report file should exist at %s", cocPath)
	require.Greater(t, info.Size(), int64(0), "CoC report should not be empty")

	t.Logf("[M-003] CoC Report saved: %s (%d bytes)", cocPath, info.Size())
	fmt.Printf("[M-003] src=%s dst=%s coc=%s\n", mf.srcFSName, mf.dstFSName, cocPath)
	fmt.Println("[MIGRATION M-003 PASSED] Custom options migration completed and CoC Report downloaded")
}

// ═════════════════════════════════════════════════════════════════════════════
// M-004  Basic SMB Migration (SMB source → SMB destination)
//
// Creates fresh SMB source and destination file servers, runs the Bulk Migrate
// wizard selecting SMB shares, waits for job completion, and downloads CoC.
// ═════════════════════════════════════════════════════════════════════════════

func TestMigration_BasicSMB(t *testing.T) {
	t.Parallel()
	requireEnv(t, config.SmbMigSourceHost, "NDM_SMB_MIG_SOURCE_HOST")
	requireEnv(t, config.SmbMigSourceShare, "NDM_SMB_MIG_SOURCE_SHARE")
	requireEnv(t, config.SmbMigDestHost, "NDM_SMB_MIG_DEST_HOST")
	requireEnv(t, config.SmbMigDestShare, "NDM_SMB_MIG_DEST_SHARE")

	const prefix = "m004"
	f, mp := newMigrationBrowserFixture(t, prefix)
	defer f.Close()

	// Always clear destination SMB share on test completion (pass or fail).
	t.Cleanup(func() {
		if err := utils.ClearSMBShare(
			config.SmbMigDestHost,
			config.SmbMigDestShare,
			config.SmbMigDestUsername,
			config.SmbMigDestPassword,
		); err != nil {
			t.Logf("[M-004] WARNING: could not clear destination share %s: %v", config.SmbMigDestShare, err)
		} else {
			t.Log("[M-004] destination SMB share cleared successfully")
		}
	})

	mf := &migrationFixture{}

	// ── 1. Create SMB source file server ─────────────────────────────────────
	By(t, "Creating SMB source file server")
	mf.srcFSID, mf.srcFSName = createFreshSMBSourceFileServer(t, f, prefix)
	f.Screenshot(prefix + "-smb-src-fs-active")
	t.Logf("[M-004] source: %s (ID: %s)", mf.srcFSName, mf.srcFSID)

	// ── 2. Create SMB destination file server ────────────────────────────────
	By(t, "Creating SMB destination file server")
	mf.dstFSID, mf.dstFSName = createFreshSMBDestinationFileServer(t, f, prefix)
	f.Screenshot(prefix + "-smb-dst-fs-active")
	t.Logf("[M-004] destination: %s (ID: %s)", mf.dstFSName, mf.dstFSID)

	// ── 3. Navigate to source file server overview ───────────────────────────
	By(t, "Navigating to source file server overview")
	require.NoError(t,
		mp.NavigateToFileServerOverview(mf.srcFSID),
		"navigate to source file server overview",
	)
	f.Screenshot("smb-mig-src-overview")

	// ── 4. Open Bulk Migrate wizard ──────────────────────────────────────────
	By(t, "Opening Bulk Migrate wizard")
	require.NoError(t, mp.OpenBulkMigrateForm(), "open Bulk Migrate form")
	f.Screenshot("smb-mig-wizard-mapping-step")

	// ── 5. Mapping step ──────────────────────────────────────────────────────
	By(t, "Selecting source SMB share")
	require.NoError(t,
		mp.SelectSourcePath(config.SmbMigSourceShare),
		"select source share %s", config.SmbMigSourceShare,
	)

	By(t, "Selecting destination file server in mapping (with retry)")
	require.NoError(t,
		mp.SelectDestinationFileServerWithRetry(mf.srcFSID, mf.dstFSName, config.SmbMigSourceShare, 3),
		"select destination file server %s", mf.dstFSName,
	)

	By(t, "Selecting destination SMB share")
	require.NoError(t,
		mp.SelectDestinationPath(config.SmbMigDestShare),
		"select destination share %s", config.SmbMigDestShare,
	)

	// ── 6. Add mapping ───────────────────────────────────────────────────────
	By(t, "Adding path mapping")
	require.NoError(t, mp.AddMapping(), "add mapping")
	f.Screenshot("smb-mig-mapping-row-added")

	// ── 7. Proceed from Mapping step ─────────────────────────────────────────
	By(t, "Proceeding from Mapping step")
	require.NoError(t, mp.ProceedFromMapping(), "proceed from mapping step")
	f.Screenshot("smb-mig-options-step")

	// ── 8. Options step — leave defaults, proceed ────────────────────────────
	By(t, "Proceeding from Options step (defaults)")
	require.NoError(t, mp.ProceedFromOptions(), "proceed from options step")
	f.Screenshot("smb-mig-review-step")

	// ── 9. Review step — select all mappings, submit ─────────────────────────
	By(t, "Selecting all mappings on Review step")
	require.NoError(t, mp.SelectAllMappingsOnReview(), "select all mappings on review")

	By(t, "Submitting migration job")
	require.NoError(t, mp.SubmitMigration(), "submit migration job")

	// ── 10. Navigate to Job Run List ─────────────────────────────────────────
	By(t, "Navigating to Job Run List")
	require.NoError(t, mp.NavigateToJobRunList(), "navigate to job run list")
	f.Screenshot("smb-mig-job-run-list")

	// ── 11. Wait for migration job to complete ───────────────────────────────
	By(t, "Waiting for SMB migration job to complete (20 min timeout)")
	require.NoError(t,
		mp.WaitForMigrationCompleted(config.SmbMigrationTimeoutMs),
		"SMB migration job did not complete within timeout",
	)
	f.Screenshot("smb-mig-job-completed")
	t.Log("[M-004] SMB migration job completed successfully")

	// ── 12. Download CoC Report ──────────────────────────────────────────────
	By(t, "Downloading CoC Report")
	downloadDir := filepath.Join("test-results", "downloads")
	require.NoError(t, os.MkdirAll(downloadDir, 0o755))

	cocPath, err := mp.DownloadCoCReport(downloadDir)
	require.NoError(t, err, "download CoC report")

	info, statErr := os.Stat(cocPath)
	require.NoError(t, statErr, "CoC report file should exist at %s", cocPath)
	require.Greater(t, info.Size(), int64(0), "CoC report should not be empty")

	t.Logf("[M-004] CoC Report saved: %s (%d bytes)", cocPath, info.Size())
	fmt.Printf("[M-004] src=%s dst=%s coc=%s\n", mf.srcFSName, mf.dstFSName, cocPath)
	fmt.Println("[MIGRATION M-004 PASSED] SMB migration completed and CoC Report downloaded")

	// ── 13. Validate CoC Report (CSV-only: checksums + status) ───────────────
	By(t, "Validating CoC Report")
	srcShare := fmt.Sprintf(`\\%s\%s`, config.SmbMigSourceHost, config.SmbMigSourceShare)
	dstShare := fmt.Sprintf(`\\%s\%s`, config.SmbMigDestHost, config.SmbMigDestShare)

	result, valErr := utils.ValidateReport(
		utils.ReportTypeMigration,
		utils.ProtocolSMB,
		cocPath,
		srcShare,
		dstShare,
	)
	require.NoError(t, valErr, "CoC report validation failed")
	require.True(t, result.Match,
		"[M-004] CoC report issues:\n%s", result.String())
	t.Log("[M-004] CoC Report validated successfully")

	// ── 13b. Static checksum validation (known files with pre-computed hashes) ──
	By(t, "Validating static file checksums against CoC report")
	smbSpecPath := filepath.Join("validators", "smb_migration_checksums.json")
	if _, statErr := os.Stat(smbSpecPath); statErr == nil {
		staticResult, staticErr := utils.ValidateCoCStaticChecksums(cocPath, smbSpecPath)
		require.NoError(t, staticErr, "static checksum validation failed")
		require.True(t, staticResult.Match,
			"[M-004] static checksum mismatch:\n%s", staticResult.String())
		t.Log("[M-004] static checksum validation PASSED")
	} else {
		t.Log("[M-004] no static checksum spec found — skipping")
	}

	// ── 14. Direct src ↔ dst metadata comparison via Windows worker ──────────
	// Scans both shares via PowerShell, writes TSV files for inspection, compares.
	By(t, "Comparing source and destination SMB metadata via PowerShell")
	smbResult, srcEntries, dstEntries, smbErr := utils.CompareSMBMetadataWithEntries(srcShare, dstShare, utils.SMBCompareOptions{
		SkipAtime: true,
	})
	require.NoError(t, smbErr, "SMB metadata comparison failed")

	// Write raw entries to TSV for debugging/inspection.
	smbDownloadDir := filepath.Join("test-results", "downloads")
	_ = os.MkdirAll(smbDownloadDir, 0o755)
	writeSMBMetadataTSV(filepath.Join(smbDownloadDir, "src_smb_metadata.tsv"), srcEntries)
	writeSMBMetadataTSV(filepath.Join(smbDownloadDir, "dst_smb_metadata.tsv"), dstEntries)
	t.Logf("[M-004] metadata TSV files written: src=%d entries, dst=%d entries", len(srcEntries), len(dstEntries))

	if smbResult.HasMismatches() {
		var diffs []string
		for _, p := range smbResult.SrcOnlyPaths {
			diffs = append(diffs, fmt.Sprintf("EXISTS_IN_SRC_ONLY: %s", p))
		}
		for _, p := range smbResult.DstOnlyPaths {
			diffs = append(diffs, fmt.Sprintf("EXISTS_IN_DST_ONLY: %s", p))
		}
		for _, d := range smbResult.Discrepancies {
			diffs = append(diffs, fmt.Sprintf("path=%s field=%s src=%q dst=%q",
				d.Path, d.Field, d.SrcValue, d.DstValue))
		}
		require.Fail(t,
			fmt.Sprintf("[M-004] SMB metadata mismatch (%s):\n  %s",
				smbResult.Summary(), strings.Join(diffs, "\n  ")))
	}
	t.Logf("[M-004] SMB metadata comparison PASSED: %s", smbResult.Summary())
}

// ── helpers ──────────────────────────────────────────────────────────────────

// createFreshSMBSourceFileServer creates a new SMB source file server for
// migration, attaches a worker, and waits until Active.
func createFreshSMBSourceFileServer(t *testing.T, f *fixtures.AuthFixture, prefix string) (fsID string, fsName string) {
	t.Helper()
	requireEnv(t, config.SmbMigSourceHost, "NDM_SMB_MIG_SOURCE_HOST")
	requireEnv(t, config.SmbMigSourceUsername, "NDM_SMB_MIG_SOURCE_USERNAME")
	requireEnv(t, config.SmbMigSourcePassword, "NDM_SMB_MIG_SOURCE_PASSWORD")

	fsName = fmt.Sprintf("%s-%d", config.SmbMigSourceFileServerNamePrefix, time.Now().UnixMilli())
	t.Logf("[setup] creating SMB source file server %q on host %s", fsName, config.SmbMigSourceHost)

	fsp := pages.NewFileServerPage(f.Page, prefix)
	var err error
	fsID, err = fsp.CreateSMBFileServer(
		fsName,
		config.SmbMigSourceHost,
		config.SmbMigSourceAdServerIP,
		config.SmbMigSourceUsername,
		config.SmbMigSourcePassword,
		config.MinWorkers,
	)
	require.NoError(t, err, "create SMB source file server via wizard")
	t.Logf("[setup] SMB source file server %s (ID: %s) created — waiting for Active…", fsName, fsID)

	require.NoError(t,
		fsp.WaitForFileServerActive(fsID, 300000),
		"SMB source file server did not become active within 5 minutes",
	)
	t.Logf("[setup] SMB source file server %s is now Active", fsName)
	return fsID, fsName
}

// createFreshSMBDestinationFileServer creates a new SMB destination file server
// for migration, attaches a worker, and waits until Active.
func createFreshSMBDestinationFileServer(t *testing.T, f *fixtures.AuthFixture, prefix string) (fsID string, fsName string) {
	t.Helper()
	requireEnv(t, config.SmbMigDestHost, "NDM_SMB_MIG_DEST_HOST")
	requireEnv(t, config.SmbMigDestUsername, "NDM_SMB_MIG_DEST_USERNAME")
	requireEnv(t, config.SmbMigDestPassword, "NDM_SMB_MIG_DEST_PASSWORD")

	fsName = fmt.Sprintf("%s-%d", config.SmbMigDestFileServerNamePrefix, time.Now().UnixMilli())
	t.Logf("[setup] creating SMB destination file server %q on host %s", fsName, config.SmbMigDestHost)

	fsp := pages.NewFileServerPage(f.Page, prefix)
	var err error
	fsID, err = fsp.CreateSMBFileServer(
		fsName,
		config.SmbMigDestHost,
		config.SmbMigDestAdServerIP,
		config.SmbMigDestUsername,
		config.SmbMigDestPassword,
		config.MinWorkers,
	)
	require.NoError(t, err, "create SMB destination file server via wizard")
	t.Logf("[setup] SMB destination file server %s (ID: %s) created — waiting for Active…", fsName, fsID)

	require.NoError(t,
		fsp.WaitForFileServerActive(fsID, 300000),
		"SMB destination file server did not become active within 5 minutes",
	)
	t.Logf("[setup] SMB destination file server %s is now Active", fsName)
	return fsID, fsName
}

// ═════════════════════════════════════════════════════════════════════════════
// M-005  Job Config Details — Summary vs Run History Consistency
//
// Validates that the "Summary of Last Run" cards on the Job Config Details
// page match the latest row in the Run History table:
//   - Files count in summary = Files in latest Run History row
//   - Size in summary = Size in latest Run History row
//   - Latest Errors (N) in summary = Errors in latest Run History row
// ═════════════════════════════════════════════════════════════════════════════

func TestMigration_JobConfigSummaryConsistency(t *testing.T) {
	t.Parallel()
	srcExportPath := config.GetSourceExportPath(0)
	requireEnv(t, srcExportPath, "NDM_NFS_SOURCE_EXPORT_PATH")
	dstExportPath := config.GetDestinationExportPath(0)
	requireEnv(t, dstExportPath, "NDM_NFS_DESTINATION_EXPORT_PATH")

	const prefix = "m005"
	f, mp := newMigrationBrowserFixture(t, prefix)
	defer f.Close()

	t.Cleanup(func() {
		dstExport := fmt.Sprintf("%s:%s", config.NfsDestinationHost, dstExportPath)
		if err := utils.ClearNFSVolume(dstExport); err != nil {
			t.Logf("[M-005] WARNING: could not clear destination volume %s: %v", dstExport, err)
		} else {
			t.Log("[M-005] destination volume cleared successfully")
		}
	})

	mf := &migrationFixture{}

	// ── 1. Create source + destination file servers ──────────────────────────
	By(t, "Creating source NFS file server")
	mf.srcFSID, mf.srcFSName = createFreshSourceFileServer(t, f, prefix)
	t.Logf("[M-005] source: %s (ID: %s)", mf.srcFSName, mf.srcFSID)

	By(t, "Creating destination NFS file server")
	mf.dstFSID, mf.dstFSName = createFreshDestinationFileServer(t, f, prefix)
	t.Logf("[M-005] destination: %s (ID: %s)", mf.dstFSName, mf.dstFSID)

	// ── 2. Run Bulk Migrate ──────────────────────────────────────────────────
	By(t, "Navigating to source file server overview")
	require.NoError(t, mp.NavigateToFileServerOverview(mf.srcFSID),
		"navigate to source file server overview")

	By(t, "Opening Bulk Migrate wizard")
	require.NoError(t, mp.OpenBulkMigrateForm(), "open Bulk Migrate form")

	By(t, "Selecting source export path")
	require.NoError(t, mp.SelectSourcePath(srcExportPath),
		"select source path %s", srcExportPath)

	By(t, "Selecting destination file server")
	require.NoError(t,
		mp.SelectDestinationFileServerWithRetry(mf.srcFSID, mf.dstFSName, srcExportPath, 3),
		"select destination file server %s", mf.dstFSName)

	By(t, "Selecting destination export path")
	require.NoError(t, mp.SelectDestinationPath(dstExportPath),
		"select destination path %s", dstExportPath)

	By(t, "Adding path mapping")
	require.NoError(t, mp.AddMapping(), "add mapping")

	By(t, "Proceeding from Mapping step")
	require.NoError(t, mp.ProceedFromMapping(), "proceed from mapping step")

	By(t, "Proceeding from Options step (defaults)")
	require.NoError(t, mp.ProceedFromOptions(), "proceed from options step")

	By(t, "Selecting all mappings on Review step")
	require.NoError(t, mp.SelectAllMappingsOnReview(), "select all mappings on review")

	By(t, "Submitting migration job")
	require.NoError(t, mp.SubmitMigration(), "submit migration job")

	// ── 3. Navigate to Job Run List and wait for completion ───────────────────
	By(t, "Navigating to Job Run List")
	require.NoError(t, mp.NavigateToJobRunList(), "navigate to job run list")

	By(t, "Waiting for migration job to complete")
	require.NoError(t,
		mp.WaitForMigrationCompleted(config.MigrationTimeoutMs),
		"migration job did not complete within timeout")
	t.Log("[M-005] migration job completed")
	f.Screenshot(prefix + "-mig-completed")

	// ── 4. Navigate to Job Config Details via overflow menu ───────────────────
	By(t, "Navigating to Job Config Details from Job Run List")
	configID := navigateToJobConfigFromRunList(t, mp)
	require.NotEmpty(t, configID, "job config ID should not be empty")
	t.Logf("[M-005] job config ID: %s", configID)

	require.NoError(t, mp.NavigateToJobConfigDetails(configID),
		"navigate to job config details")
	f.Screenshot(prefix + "-job-config-details")

	// ── 5. Read the summary section ──────────────────────────────────────────
	By(t, "Reading Job Config Summary")
	summary, err := mp.GetJobConfigSummary()
	require.NoError(t, err, "read job config summary")
	t.Logf("[M-005] summary: files=%s size=%s errors=%s",
		summary.Files, summary.Size, summary.Errors)

	// ── 6. Read the Run History table ────────────────────────────────────────
	By(t, "Reading Run History table")
	mp.ClickRunHistoryTab()
	f.Screenshot(prefix + "-run-history-table")

	rows, err := mp.GetRunHistoryRows()
	require.NoError(t, err, "read run history rows")
	require.NotEmpty(t, rows, "run history table should have at least one row")
	t.Logf("[M-005] run history: %d row(s), latest: files=%s size=%s errors=%s status=%s",
		len(rows), rows[0].Files, rows[0].Size, rows[0].Errors, rows[0].Status)

	latestRow := rows[0]

	// ── 7. Validate: Summary Files = Latest Row Files ────────────────────────
	By(t, "Validating summary Files matches latest run Files")
	require.Equal(t, summary.Files, latestRow.Files,
		"summary Files (%s) should match latest Run History row Files (%s)",
		summary.Files, latestRow.Files)

	// ── 8. Validate: Summary Size = Latest Row Size ──────────────────────────
	By(t, "Validating summary Size matches latest run Size")
	require.Equal(t, summary.Size, latestRow.Size,
		"summary Size (%s) should match latest Run History row Size (%s)",
		summary.Size, latestRow.Size)

	// ── 9. Validate: Latest Errors count = Latest Row Errors ─────────────────
	By(t, "Validating Latest Errors count matches latest run Errors")
	expectedErrors := summary.Errors
	if expectedErrors == "" {
		expectedErrors = "0"
	}
	actualErrors := latestRow.Errors
	if actualErrors == "" || actualErrors == "-" {
		actualErrors = "0"
	}
	require.Equal(t, expectedErrors, actualErrors,
		"summary Latest Errors (%s) should match latest Run History row Errors (%s)",
		expectedErrors, actualErrors)

	t.Log("[M-005] all summary vs Run History validations passed")
	fmt.Printf("[M-005] files=%s size=%s errors=%s\n", summary.Files, summary.Size, summary.Errors)
	fmt.Println("[MIGRATION M-005 PASSED] Job Config Details summary is consistent with Run History")
}

// By logs a step label so test output is easy to follow.
func By(t *testing.T, step string) {
	t.Helper()
	t.Logf("=== %s", step)
}

// writeDiffsTSV writes NFS comparison discrepancies to a TSV file with context
// so it can be uploaded as a pipeline artifact and inspected later.
func writeDiffsTSV(path string, discrepancies []utils.NFSScriptDiscrepancy, src, dst string) {
	f, err := os.Create(path)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "# NFS Metadata Comparison Diffs\n")
	fmt.Fprintf(f, "# Source: %s\n", src)
	fmt.Fprintf(f, "# Destination: %s\n", dst)
	fmt.Fprintf(f, "# Timestamp: %s\n", time.Now().UTC().Format(time.RFC3339))
	fmt.Fprintf(f, "# Run ID: %s\n", os.Getenv("GITHUB_RUN_ID"))
	fmt.Fprintf(f, "# Total discrepancies: %d\n", len(discrepancies))
	fmt.Fprintf(f, "path\tfield\tsource_value\tdestination_value\n")
	for _, d := range discrepancies {
		fmt.Fprintf(f, "%s\t%s\t%s\t%s\n", d.Path, d.Field, d.SrcValue, d.DstValue)
	}
}

// writeSMBMetadataTSV writes SMB metadata entries to a TSV file for inspection.
func writeSMBMetadataTSV(path string, entries []utils.SMBMetadataEntry) {
	f, err := os.Create(path)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "path\ttype\tsize_bytes\tmtime_epoch\tatime_epoch\towner\n")
	for _, e := range entries {
		fmt.Fprintf(f, "%s\t%s\t%d\t%d\t%d\t%s\n",
			e.Path, e.Type, e.SizeBytes, e.MtimeEpoch, e.AtimeEpoch, e.Owner)
	}
}
