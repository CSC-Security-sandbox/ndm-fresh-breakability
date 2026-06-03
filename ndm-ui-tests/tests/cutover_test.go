// Package tests — Cutover UI E2E flows.
//
// Tests that validate the Bulk Cutover behavior:
//   1. Run a baseline migration (same as M-001)
//   2. Wait for migration to complete
//   3. Navigate to the source file server overview
//   4. Click "Bulk Cutover"
//   5. Select the completed job config path
//   6. Accept the cutover acknowledgment checkbox
//   7. Proceed to Review step
//   8. Submit the cutover job
//   9. Wait for cutover to reach "Blocked" state (awaiting approval)
//  10. Open the "..." menu on the blocked row → click "Review"
//  11. Check "I have reviewed" checkbox → click "Confirm"
//  12. Wait for cutover job to reach "Approved" state
//
// Required env vars (same as NFS migration):
//   NDM_NFS_SOURCE_HOST
//   NDM_NFS_SOURCE_EXPORT_PATH or NDM_NFS_SOURCE_EXPORT_PATHS
//   NDM_NFS_DESTINATION_HOST
//   NDM_NFS_DESTINATION_EXPORT_PATH or NDM_NFS_DESTINATION_EXPORT_PATHS
//   NDM_MIGRATION_TIMEOUT_MS (default: 600000)
//
// Test index:
//
//	C-001 TestCutover_BasicNFS — baseline migration + Bulk Cutover submission
package tests

import (
	"fmt"
	"testing"
	"time"

	"ndm-ui-tests/config"
	"ndm-ui-tests/fixtures"
	"ndm-ui-tests/pages"
	"ndm-ui-tests/utils"

	"github.com/stretchr/testify/require"
)

// newCutoverBrowserFixture creates the auth fixture and migration page object
// for the cutover test flow.
func newCutoverBrowserFixture(t *testing.T, prefix string) (*fixtures.AuthFixture, *pages.MigrationPage) {
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

// ═════════════════════════════════════════════════════════════════════════════
// C-001  Basic NFS Cutover (baseline migration → Bulk Cutover submission)
//
// Flow:
//   1. Create fresh NFS source + destination file servers
//   2. Run baseline Bulk Migrate (NFS → NFS)
//   3. Wait for migration to complete
//   4. Navigate back to source file server overview
//   5. Click "Bulk Cutover"
//   6. Select the path row for the completed migration
//   7. Accept the "I understand Cutover requires downtime..." checkbox
//   8. Click "Proceed"
//   9. On Review step, click "Submit"
//  10. Wait for cutover job to reach "Blocked" state
// ═════════════════════════════════════════════════════════════════════════════

func TestCutover_BasicNFS(t *testing.T) {
	t.Parallel()
	srcExportPath := config.GetSourceExportPath(0)
	requireEnv(t, srcExportPath, "NDM_NFS_SOURCE_EXPORT_PATH")
	dstExportPath := config.GetDestinationExportPath(0)
	requireEnv(t, dstExportPath, "NDM_NFS_DESTINATION_EXPORT_PATH")

	const prefix = "c001"
	f, mp := newCutoverBrowserFixture(t, prefix)
	defer f.Close()

	// Always clear destination volume on test completion (pass or fail).
	t.Cleanup(func() {
		dstExport := fmt.Sprintf("%s:%s", config.NfsDestinationHost, dstExportPath)
		if err := utils.ClearNFSVolume(dstExport); err != nil {
			t.Logf("[C-001] WARNING: could not clear destination volume %s: %v", dstExport, err)
		} else {
			t.Log("[C-001] destination volume cleared successfully")
		}
	})

	mf := &migrationFixture{}

	// ── 1. Create source file server ─────────────────────────────────────────
	By(t, "Creating source NFS file server")
	mf.srcFSID, mf.srcFSName = createFreshSourceFileServer(t, f, prefix)
	f.Screenshot(prefix + "-cutover-src-fs-active")
	t.Logf("[C-001] source: %s (ID: %s)", mf.srcFSName, mf.srcFSID)

	// ── 2. Create destination file server ────────────────────────────────────
	By(t, "Creating destination NFS file server")
	mf.dstFSID, mf.dstFSName = createFreshDestinationFileServer(t, f, prefix)
	f.Screenshot(prefix + "-cutover-dst-fs-active")
	t.Logf("[C-001] destination: %s (ID: %s)", mf.dstFSName, mf.dstFSID)

	// ── 3. Navigate to source file server overview ───────────────────────────
	By(t, "Navigating to source file server overview")
	require.NoError(t,
		mp.NavigateToFileServerOverview(mf.srcFSID),
		"navigate to source file server overview",
	)
	f.Screenshot(prefix + "-cutover-src-overview")

	// ── 4. Open Bulk Migrate wizard ──────────────────────────────────────────
	By(t, "Opening Bulk Migrate wizard")
	require.NoError(t, mp.OpenBulkMigrateForm(), "open Bulk Migrate form")
	f.Screenshot(prefix + "-cutover-mapping-step")

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
	f.Screenshot(prefix + "-cutover-mapping-added")

	// ── 7. Proceed from Mapping step ─────────────────────────────────────────
	By(t, "Proceeding from Mapping step")
	require.NoError(t, mp.ProceedFromMapping(), "proceed from mapping step")
	f.Screenshot(prefix + "-cutover-options-step")

	// ── 8. Options step — leave defaults, proceed ────────────────────────────
	By(t, "Proceeding from Options step (defaults)")
	require.NoError(t, mp.ProceedFromOptions(), "proceed from options step")
	f.Screenshot(prefix + "-cutover-review-step")

	// ── 9. Review step — select all mappings, submit ─────────────────────────
	By(t, "Selecting all mappings on Review step")
	require.NoError(t, mp.SelectAllMappingsOnReview(), "select all mappings on review")

	By(t, "Submitting migration job")
	require.NoError(t, mp.SubmitMigration(), "submit migration job")

	// ── 10. Navigate to Job Run List ─────────────────────────────────────────
	By(t, "Navigating to Job Run List")
	require.NoError(t, mp.NavigateToJobRunList(), "navigate to job run list")
	f.Screenshot(prefix + "-cutover-job-run-list")

	// ── 11. Wait for baseline migration to complete ──────────────────────────
	By(t, "Waiting for baseline migration to complete")
	require.NoError(t,
		mp.WaitForMigrationCompleted(config.MigrationTimeoutMs),
		"baseline migration did not complete within timeout",
	)
	f.Screenshot(prefix + "-cutover-baseline-completed")
	t.Log("[C-001] baseline migration completed successfully")

	// ── 12. Navigate back to source file server overview ─────────────────────
	By(t, "Navigating back to source file server overview for cutover")
	time.Sleep(3 * time.Second)
	require.NoError(t,
		mp.NavigateToFileServerOverview(mf.srcFSID),
		"navigate to source file server overview for cutover",
	)
	f.Screenshot(prefix + "-cutover-fs-overview-before-cutover")

	// ── 13. Open Bulk Cutover wizard ─────────────────────────────────────────
	By(t, "Opening Bulk Cutover wizard")
	require.NoError(t, mp.OpenBulkCutoverForm(), "open Bulk Cutover form")
	f.Screenshot(prefix + "-cutover-select-path-step")

	// ── 14. Select the path row for the completed migration ──────────────────
	By(t, "Selecting cutover path")
	require.NoError(t, mp.SelectCutoverPath(), "select cutover path row")
	f.Screenshot(prefix + "-cutover-path-selected")

	// ── 15. Accept the cutover acknowledgment checkbox ───────────────────────
	By(t, "Accepting cutover downtime acknowledgment")
	require.NoError(t, mp.AcceptCutoverWarning(), "accept cutover warning checkbox")
	f.Screenshot(prefix + "-cutover-warning-accepted")

	// ── 16. Proceed from Select Path step ────────────────────────────────────
	By(t, "Proceeding from Select Path to Review")
	require.NoError(t, mp.ProceedFromCutoverSelectPath(), "proceed from cutover select path")
	f.Screenshot(prefix + "-cutover-review-step")

	// ── 17. Submit cutover ───────────────────────────────────────────────────
	By(t, "Submitting cutover job")
	require.NoError(t, mp.SubmitCutover(), "submit cutover job")
	f.Screenshot(prefix + "-cutover-submitted")
	t.Log("[C-001] cutover job submitted")

	// ── 18. Navigate to Job Run List and wait for Blocked state ──────────────
	By(t, "Navigating to Job Run List to monitor cutover")
	require.NoError(t, mp.NavigateToJobRunList(), "navigate to job run list for cutover")

	By(t, "Waiting for cutover job to reach Blocked state")
	require.NoError(t,
		mp.WaitForCutoverBlocked(config.MigrationTimeoutMs),
		"cutover job did not reach Blocked state within timeout",
	)
	f.Screenshot(prefix + "-cutover-blocked")
	t.Log("[C-001] cutover job reached Blocked state (awaiting approval)")

	// ── 19. Approve the cutover ──────────────────────────────────────────────
	By(t, "Approving cutover via Review dialog")
	require.NoError(t, mp.ApproveCutover(), "approve cutover")
	f.Screenshot(prefix + "-cutover-approved-action")
	t.Log("[C-001] cutover approval submitted")

	// ── 20. Wait for cutover to reach Approved state ─────────────────────────
	By(t, "Waiting for cutover job to reach Approved state")
	require.NoError(t,
		mp.WaitForCutoverApproved(config.MigrationTimeoutMs),
		"cutover job did not reach Approved state within timeout",
	)
	f.Screenshot(prefix + "-cutover-approved")
	t.Log("[C-001] cutover job reached Approved state")

	fmt.Printf("[C-001] src=%s dst=%s\n", mf.srcFSName, mf.dstFSName)
	fmt.Println("[CUTOVER C-001 PASSED] Baseline migration + Bulk Cutover approved successfully")
}

// ═════════════════════════════════════════════════════════════════════════════
// C-002  Basic SMB Cutover (baseline SMB migration → Bulk Cutover → Approved)
//
// Flow:
//   1. Create fresh SMB source + destination file servers
//   2. Run baseline Bulk Migrate (SMB → SMB)
//   3. Wait for migration to complete
//   4. Navigate back to source file server overview
//   5. Click "Bulk Cutover"
//   6. Select the path row for the completed migration
//   7. Accept the "I understand Cutover requires downtime..." checkbox
//   8. Click "Proceed"
//   9. On Review step, click "Submit"
//  10. Wait for cutover job to reach "Blocked" state
//  11. Open "..." menu → click "Review"
//  12. Check "I have reviewed" checkbox → click "Confirm"
//  13. Wait for cutover job to reach "Approved" state
// ═════════════════════════════════════════════════════════════════════════════

func TestCutover_BasicSMB(t *testing.T) {
	t.Parallel()
	requireEnv(t, config.SmbMigSourceHost, "NDM_SMB_MIG_SOURCE_HOST")
	requireEnv(t, config.SmbMigSourceShare, "NDM_SMB_MIG_SOURCE_SHARE")
	requireEnv(t, config.SmbMigDestHost, "NDM_SMB_MIG_DEST_HOST")
	requireEnv(t, config.SmbMigDestShare, "NDM_SMB_MIG_DEST_SHARE")

	const prefix = "c002"
	f, mp := newCutoverBrowserFixture(t, prefix)
	defer f.Close()

	// Always clear destination SMB share on test completion (pass or fail).
	t.Cleanup(func() {
		if err := utils.ClearSMBShare(
			config.SmbMigDestHost,
			config.SmbMigDestShare,
			config.SmbMigDestUsername,
			config.SmbMigDestPassword,
		); err != nil {
			t.Logf("[C-002] WARNING: could not clear destination share %s: %v", config.SmbMigDestShare, err)
		} else {
			t.Log("[C-002] destination SMB share cleared successfully")
		}
	})

	mf := &migrationFixture{}

	// ── 1. Create SMB source file server ─────────────────────────────────────
	By(t, "Creating SMB source file server")
	mf.srcFSID, mf.srcFSName = createFreshSMBSourceFileServer(t, f, prefix)
	f.Screenshot(prefix + "-cutover-smb-src-fs-active")
	t.Logf("[C-002] source: %s (ID: %s)", mf.srcFSName, mf.srcFSID)

	// ── 2. Create SMB destination file server ────────────────────────────────
	By(t, "Creating SMB destination file server")
	mf.dstFSID, mf.dstFSName = createFreshSMBDestinationFileServer(t, f, prefix)
	f.Screenshot(prefix + "-cutover-smb-dst-fs-active")
	t.Logf("[C-002] destination: %s (ID: %s)", mf.dstFSName, mf.dstFSID)

	// ── 3. Navigate to source file server overview ───────────────────────────
	By(t, "Navigating to source file server overview")
	require.NoError(t,
		mp.NavigateToFileServerOverview(mf.srcFSID),
		"navigate to source file server overview",
	)
	f.Screenshot(prefix + "-cutover-smb-src-overview")

	// ── 4. Open Bulk Migrate wizard ──────────────────────────────────────────
	By(t, "Opening Bulk Migrate wizard")
	require.NoError(t, mp.OpenBulkMigrateForm(), "open Bulk Migrate form")
	f.Screenshot(prefix + "-cutover-smb-mapping-step")

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
	f.Screenshot(prefix + "-cutover-smb-mapping-added")

	// ── 7. Proceed from Mapping step ─────────────────────────────────────────
	By(t, "Proceeding from Mapping step")
	require.NoError(t, mp.ProceedFromMapping(), "proceed from mapping step")
	f.Screenshot(prefix + "-cutover-smb-options-step")

	// ── 8. Options step — leave defaults, proceed ────────────────────────────
	By(t, "Proceeding from Options step (defaults)")
	require.NoError(t, mp.ProceedFromOptions(), "proceed from options step")
	f.Screenshot(prefix + "-cutover-smb-review-step")

	// ── 9. Review step — select all mappings, submit ─────────────────────────
	By(t, "Selecting all mappings on Review step")
	require.NoError(t, mp.SelectAllMappingsOnReview(), "select all mappings on review")

	By(t, "Submitting migration job")
	require.NoError(t, mp.SubmitMigration(), "submit migration job")

	// ── 10. Navigate to Job Run List ─────────────────────────────────────────
	By(t, "Navigating to Job Run List")
	require.NoError(t, mp.NavigateToJobRunList(), "navigate to job run list")
	f.Screenshot(prefix + "-cutover-smb-job-run-list")

	// ── 11. Wait for baseline SMB migration to complete ──────────────────────
	By(t, "Waiting for baseline SMB migration to complete")
	require.NoError(t,
		mp.WaitForMigrationCompleted(config.SmbMigrationTimeoutMs),
		"baseline SMB migration did not complete within timeout",
	)
	f.Screenshot(prefix + "-cutover-smb-baseline-completed")
	t.Log("[C-002] baseline SMB migration completed successfully")

	// ── 12. Navigate back to source file server overview ─────────────────────
	By(t, "Navigating back to source file server overview for cutover")
	time.Sleep(3 * time.Second)
	require.NoError(t,
		mp.NavigateToFileServerOverview(mf.srcFSID),
		"navigate to source file server overview for cutover",
	)
	f.Screenshot(prefix + "-cutover-smb-fs-overview-before-cutover")

	// ── 13. Open Bulk Cutover wizard ─────────────────────────────────────────
	By(t, "Opening Bulk Cutover wizard")
	require.NoError(t, mp.OpenBulkCutoverForm(), "open Bulk Cutover form")
	f.Screenshot(prefix + "-cutover-smb-select-path-step")

	// ── 14. Select the path row for the completed migration ──────────────────
	By(t, "Selecting cutover path")
	require.NoError(t, mp.SelectCutoverPath(), "select cutover path row")
	f.Screenshot(prefix + "-cutover-smb-path-selected")

	// ── 15. Accept the cutover acknowledgment checkbox ───────────────────────
	By(t, "Accepting cutover downtime acknowledgment")
	require.NoError(t, mp.AcceptCutoverWarning(), "accept cutover warning checkbox")
	f.Screenshot(prefix + "-cutover-smb-warning-accepted")

	// ── 16. Proceed from Select Path step ────────────────────────────────────
	By(t, "Proceeding from Select Path to Review")
	require.NoError(t, mp.ProceedFromCutoverSelectPath(), "proceed from cutover select path")
	f.Screenshot(prefix + "-cutover-smb-review-step")

	// ── 17. Submit cutover ───────────────────────────────────────────────────
	By(t, "Submitting cutover job")
	require.NoError(t, mp.SubmitCutover(), "submit cutover job")
	f.Screenshot(prefix + "-cutover-smb-submitted")
	t.Log("[C-002] cutover job submitted")

	// ── 18. Navigate to Job Run List and wait for Blocked state ──────────────
	By(t, "Navigating to Job Run List to monitor cutover")
	require.NoError(t, mp.NavigateToJobRunList(), "navigate to job run list for cutover")

	By(t, "Waiting for cutover job to reach Blocked state")
	require.NoError(t,
		mp.WaitForCutoverBlocked(config.SmbMigrationTimeoutMs),
		"cutover job did not reach Blocked state within timeout",
	)
	f.Screenshot(prefix + "-cutover-smb-blocked")
	t.Log("[C-002] cutover job reached Blocked state (awaiting approval)")

	// ── 19. Approve the cutover ──────────────────────────────────────────────
	By(t, "Approving cutover via Review dialog")
	require.NoError(t, mp.ApproveCutover(), "approve cutover")
	f.Screenshot(prefix + "-cutover-smb-approved-action")
	t.Log("[C-002] cutover approval submitted")

	// ── 20. Wait for cutover to reach Approved state ─────────────────────────
	By(t, "Waiting for cutover job to reach Approved state")
	require.NoError(t,
		mp.WaitForCutoverApproved(config.SmbMigrationTimeoutMs),
		"cutover job did not reach Approved state within timeout",
	)
	f.Screenshot(prefix + "-cutover-smb-approved")
	t.Log("[C-002] cutover job reached Approved state")

	fmt.Printf("[C-002] src=%s dst=%s\n", mf.srcFSName, mf.dstFSName)
	fmt.Println("[CUTOVER C-002 PASSED] SMB Baseline migration + Bulk Cutover approved successfully")
}
