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
//	M-001 TestMigration_BasicNFS              — full Bulk Migrate flow (NFS → NFS)
//	M-002 TestMigration_IncrementalSyncCron   — Bulk Migrate with cron-based incremental sync
//	M-003 TestMigration_CustomOptions         — Bulk Migrate with all config options changed
package tests

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"ndm-ui-tests/config"
	"ndm-ui-tests/fixtures"
	"ndm-ui-tests/pages"

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
// needed for the migration flow.
func newMigrationBrowserFixture(t *testing.T) (*fixtures.AuthFixture, *pages.MigrationPage) {
	t.Helper()
	f := fixtures.NewAdminFixture(t)
	mp := pages.NewMigrationPage(f.Page)
	return f, mp
}

// createFreshSourceFileServer creates a new NFS source file server named
// <NDM_NFS_SOURCE_FILE_SERVER_NAME_PREFIX>-<timestamp>, attaches a worker,
// and waits until Active.
func createFreshSourceFileServer(t *testing.T, f *fixtures.AuthFixture) (fsID string, fsName string) {
	t.Helper()
	requireEnv(t, config.NfsSourceHost, "NDM_NFS_SOURCE_HOST")

	fsName = fmt.Sprintf("%s-%d", config.NfsSourceFileServerNamePrefix, time.Now().UnixMilli())
	t.Logf("[setup] creating source file server %q on host %s", fsName, config.NfsSourceHost)

	fsp := pages.NewFileServerPage(f.Page)
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
func createFreshDestinationFileServer(t *testing.T, f *fixtures.AuthFixture) (fsID string, fsName string) {
	t.Helper()
	requireEnv(t, config.NfsDestinationHost, "NDM_NFS_DESTINATION_HOST")

	fsName = fmt.Sprintf("%s-%d", config.NfsDestinationFileServerNamePrefix, time.Now().UnixMilli())
	t.Logf("[setup] creating destination file server %q on host %s", fsName, config.NfsDestinationHost)

	fsp := pages.NewFileServerPage(f.Page)
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
	requireEnv(t, config.NfsSourceExportPath, "NDM_NFS_SOURCE_EXPORT_PATH")
	requireEnv(t, config.NfsDestinationExportPath, "NDM_NFS_DESTINATION_EXPORT_PATH")

	f, mp := newMigrationBrowserFixture(t)
	defer f.Close()

	mf := &migrationFixture{}

	// ── 1. Create source file server ─────────────────────────────────────────
	By(t, "Creating source NFS file server")
	mf.srcFSID, mf.srcFSName = createFreshSourceFileServer(t, f)
	f.Screenshot("mig-src-fs-active")
	t.Logf("[M-001] source: %s (ID: %s)", mf.srcFSName, mf.srcFSID)

	// ── 2. Create destination file server ────────────────────────────────────
	By(t, "Creating destination NFS file server")
	mf.dstFSID, mf.dstFSName = createFreshDestinationFileServer(t, f)
	f.Screenshot("mig-dst-fs-active")
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
		mp.SelectSourcePath(config.NfsSourceExportPath),
		"select source path %s", config.NfsSourceExportPath,
	)

	By(t, "Selecting destination file server in mapping")
	require.NoError(t,
		mp.SelectDestinationFileServer(mf.dstFSName),
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

	// ── 11. Wait for migration job to complete ───────────────────────────────
	By(t, "Waiting for migration job to complete")
	require.NoError(t,
		mp.WaitForMigrationCompleted(config.MigrationTimeoutMs),
		"migration job did not complete within timeout",
	)
	f.Screenshot("mig-job-completed")
	t.Log("[M-001] migration job completed successfully")

	// ── 12. Download CoC Report ──────────────────────────────────────────────
	By(t, "Downloading CoC Report")
	downloadDir := filepath.Join("test-results", "downloads")
	require.NoError(t, os.MkdirAll(downloadDir, 0o755))

	cocPath, err := mp.DownloadCoCReport(downloadDir)
	require.NoError(t, err, "download CoC report")

	info, statErr := os.Stat(cocPath)
	require.NoError(t, statErr, "CoC report file should exist at %s", cocPath)
	require.Greater(t, info.Size(), int64(0), "CoC report should not be empty")

	t.Logf("[M-001] CoC Report saved: %s (%d bytes)", cocPath, info.Size())
	fmt.Printf("[M-001] src=%s dst=%s coc=%s\n", mf.srcFSName, mf.dstFSName, cocPath)
	fmt.Println("[MIGRATION M-001 PASSED] NFS migration completed and CoC Report downloaded")
}

// ═════════════════════════════════════════════════════════════════════════════
// M-002  Incremental Sync via Cron Expression (NFS → NFS)
// ═════════════════════════════════════════════════════════════════════════════

func TestMigration_IncrementalSyncCron(t *testing.T) {
	requireEnv(t, config.NfsSourceExportPath, "NDM_NFS_SOURCE_EXPORT_PATH")
	requireEnv(t, config.NfsDestinationExportPath, "NDM_NFS_DESTINATION_EXPORT_PATH")

	f, mp := newMigrationBrowserFixture(t)
	defer f.Close()

	mf := &migrationFixture{}

	// ── 1. Create source file server ─────────────────────────────────────────
	By(t, "Creating source NFS file server")
	mf.srcFSID, mf.srcFSName = createFreshSourceFileServer(t, f)
	f.Screenshot("incr-src-fs-active")
	t.Logf("[M-002] source: %s (ID: %s)", mf.srcFSName, mf.srcFSID)

	// ── 2. Create destination file server ────────────────────────────────────
	By(t, "Creating destination NFS file server")
	mf.dstFSID, mf.dstFSName = createFreshDestinationFileServer(t, f)
	f.Screenshot("incr-dst-fs-active")
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
		mp.SelectSourcePath(config.NfsSourceExportPath),
		"select source path %s", config.NfsSourceExportPath,
	)

	By(t, "Selecting destination file server in mapping")
	require.NoError(t,
		mp.SelectDestinationFileServer(mf.dstFSName),
		"select destination file server %s", mf.dstFSName,
	)

	By(t, "Selecting destination export path")
	require.NoError(t,
		mp.SelectDestinationPath(config.NfsDestinationExportPath),
		"select destination path %s", config.NfsDestinationExportPath,
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
	requireEnv(t, config.NfsSourceExportPath, "NDM_NFS_SOURCE_EXPORT_PATH")
	requireEnv(t, config.NfsDestinationExportPath, "NDM_NFS_DESTINATION_EXPORT_PATH")

	f, mp := newMigrationBrowserFixture(t)
	defer f.Close()

	mf := &migrationFixture{}

	// ── 1. Create source file server ─────────────────────────────────────────
	By(t, "Creating source NFS file server")
	mf.srcFSID, mf.srcFSName = createFreshSourceFileServer(t, f)
	f.Screenshot("opts-src-fs-active")
	t.Logf("[M-003] source: %s (ID: %s)", mf.srcFSName, mf.srcFSID)

	// ── 2. Create destination file server ────────────────────────────────────
	By(t, "Creating destination NFS file server")
	mf.dstFSID, mf.dstFSName = createFreshDestinationFileServer(t, f)
	f.Screenshot("opts-dst-fs-active")
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
		mp.SelectSourcePath(config.NfsSourceExportPath),
		"select source path %s", config.NfsSourceExportPath,
	)

	By(t, "Selecting destination file server in mapping")
	require.NoError(t,
		mp.SelectDestinationFileServer(mf.dstFSName),
		"select destination file server %s", mf.dstFSName,
	)

	By(t, "Selecting destination export path")
	require.NoError(t,
		mp.SelectDestinationPath(config.NfsDestinationExportPath),
		"select destination path %s", config.NfsDestinationExportPath,
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

// ── helpers ──────────────────────────────────────────────────────────────────

// By logs a step label so test output is easy to follow.
func By(t *testing.T, step string) {
	t.Helper()
	t.Logf("=== %s", step)
}
