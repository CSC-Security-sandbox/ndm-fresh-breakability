// Package tests — Discovery UI E2E flows.
//
// Each test creates a FRESH file server via the wizard, so there are
// no stale errored runs from previous attempts. Requires NDM_SOURCE_HOST.
//
// The Bulk Discover form exposes:
//  1. Job Schedule           — Start Now  /  Schedule Date & Time (UTC)
//  2. Excluded Path Patterns — textarea  (default: */-snapshot/*, */.snapshot/*)
//  3. Select Protocol        — dropdown  (NFS | SMB)
//  4. Export Path table      — row checkboxes
//  5. Cancel / Submit
//
// Test index:
//
//	5.1  TestDiscovery_BasicNFS            — NFS scan → report generated
//	5.2  TestDiscovery_BasicSMB            — SMB scan → report generated
//	5.4  TestDiscovery_ExcludeFilePatterns — Custom exclude patterns
//	5.6  TestDiscovery_Bulk                — All paths selected in one job
//	5.16 TestDiscovery_Destination         — Scan destination for baseline
//	5.17 TestDiscovery_StoppedNoReport     — Stopped job → no report
//	5.18 TestDiscovery_Isilon              — Isilon paths auto-listed
//	5.19 TestDiscovery_ConsolidatedCSV     — Consolidated report as CSV
//	5.20 TestDiscovery_IndividualReportCSV — Individual report CSV from Job Run List
//	5.22 TestDiscovery_JobConfigSummaryConsistency — Summary of Last Run matches Run History table
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

// ── helpers ──────────────────────────────────────────────────────────────────

func requireEnv(t *testing.T, value, name string) {
	t.Helper()
	if value == "" {
		t.Skipf("skipping: %s is not set in .env", name)
	}
}

// waitForCloneExport waits until the cloned export path is visible in BOTH
// the NDM API and the file server overview UI table before Bulk Discover opens.
//
// Two-phase check (mirrors how TC-001 handles this):
//  1. API phase  — polls NDM's refresh endpoint until the volume appears in
//                  /api/v1/servers/{fsID}.  Fast; confirms NDM knows about it.
//  2. UI phase   — reloads the file server overview page and checks the export-
//                  path table until the path is rendered.  This is the source
//                  of truth for the Bulk Discover form table.
//
// Both phases run in sequence; the combined timeout is up to ~10 minutes.
// It is a no-op when cloning is not active or the export path is empty.
func waitForCloneExport(t *testing.T, dp *pages.DiscoveryPage, fsID string, clone cloneResult) {
	t.Helper()
	if discoveryVolumeSetup == nil || clone.exportPath == "" {
		return
	}

	// Phase 1: API-level check (fast ~10 s per attempt, 5 min max).
	t.Logf("[clone] phase 1 — API: polling NDM refresh for %q in file server %s…",
		clone.exportPath, fsID)
	if err := utils.WaitForExportPathInFileServer(fsID, clone.exportPath); err != nil {
		t.Logf("[clone] phase 1 WARNING: %v", err)
	}

	// Phase 2: UI-level check — waits until the path appears in the overview
	// table (which is what the Bulk Discover form renders).
	t.Logf("[clone] phase 2 — UI: waiting for %q to appear in file server overview table…",
		clone.exportPath)
	if err := dp.WaitForExportPathInOverview(fsID, clone.exportPath,
		utils.SetupAuthToken, config.BaseURL); err != nil {
		t.Logf("[clone] phase 2 WARNING: %v — proceeding; selectAll fallback will be used", err)
	}
}

// downloadDir returns a test-scoped download directory so parallel tests do
// not overwrite each other's downloaded files.
func downloadDir(t *testing.T) string {
	t.Helper()
	// Replace characters that are invalid in directory names on most OSes.
	safe := strings.NewReplacer("/", "_", " ", "_", ":", "_").Replace(t.Name())
	dir := filepath.Join("test-results", "downloads", safe)
	require.NoError(t, os.MkdirAll(dir, 0o755), "create download dir %s", dir)
	return dir
}

// cloneResult holds per-test cloned volume details together with a cleanup
// function that deletes the clone after the test completes.
type cloneResult struct {
	hostIP     string // NFS server IP or SMB server IP
	exportPath string // NFS path ("/cloneName") or SMB share name
}

// resolveNFSClone returns the NFS host and export path for a test.
//
// When discoveryVolumeSetup is populated (volume cloning is enabled):
//   - Clones the first master source volume
//   - Registers cleanup via t.Cleanup
//   - Returns the cloned volume's host IP and export path
//
// Otherwise it falls back to (config.SourceHost, config.NfsExportPath).
func resolveNFSClone(t *testing.T) cloneResult {
	t.Helper()

	if discoveryVolumeSetup == nil {
		return cloneResult{hostIP: config.SourceHost, exportPath: config.NfsExportPath}
	}

	srcVols, _, srcMgr, dstMgr, err := utils.SetupTestVolumesForTest(t, "NFS")
	if err != nil {
		t.Logf("[clone] WARNING: volume clone failed, falling back to static config: %v", err)
		return cloneResult{hostIP: config.SourceHost, exportPath: config.NfsExportPath}
	}

	t.Cleanup(func() {
		utils.CleanupTestVolumesForTest(t, srcMgr, dstMgr)
	})

	host := config.SourceHost
	if len(discoveryVolumeSetup.SourceHostIPs) > 0 {
		host = discoveryVolumeSetup.SourceHostIPs[0]
	}

	exportPath := config.NfsExportPath
	if len(srcVols) > 0 && srcVols[0] != "" {
		exportPath = "/" + srcVols[0]
	}

	t.Logf("[clone] NFS clone ready — host=%s export=%s", host, exportPath)
	return cloneResult{hostIP: host, exportPath: exportPath}
}

// resolveSMBClone returns the SMB host and share name for a test.
//
// When discoveryVolumeSetup is populated with SMB clone config:
//   - Clones the first master SMB source volume
//   - Registers cleanup via t.Cleanup
//   - Returns the cloned share's host and name
//
// Otherwise falls back to (config.SMBHost, config.SMBShare).
func resolveSMBClone(t *testing.T) cloneResult {
	t.Helper()

	// Attempt SMB-specific volume setup if SMB clone vars are present.
	hasSMBClone := hasAnyEnv(
		"AZURE_UI_SMB_SOURCE_VOLUMES",
		"ONTAP_SMB_SOURCE_VOLUMES",
		"AWS_FSXN_SMB_SOURCE_VOLUMES",
	)
	if !hasSMBClone {
		return cloneResult{hostIP: config.SMBHost, exportPath: config.SMBShare}
	}

	srcVols, _, srcMgr, dstMgr, err := utils.SetupTestVolumesForTest(t, "SMB")
	if err != nil {
		t.Logf("[clone] WARNING: SMB volume clone failed, falling back to static config: %v", err)
		return cloneResult{hostIP: config.SMBHost, exportPath: config.SMBShare}
	}

	t.Cleanup(func() {
		utils.CleanupTestVolumesForTest(t, srcMgr, dstMgr)
	})

	host := config.SMBHost
	// For SMB clones, the share name is the cloned volume name.
	shareName := config.SMBShare
	if len(srcVols) > 0 && srcVols[0] != "" {
		shareName = srcVols[0]
	}

	t.Logf("[clone] SMB clone ready — host=%s share=%s", host, shareName)
	return cloneResult{hostIP: host, exportPath: shareName}
}

func newDiscoveryFixture(t *testing.T) (*fixtures.AuthFixture, *pages.DiscoveryPage) {
	t.Helper()
	f := fixtures.NewAdminFixture(t)

	if utils.SetupProjectName != "" {
		require.NoError(t,
			pages.SwitchToProject(f.Page, utils.SetupProjectName),
			"switch to setup project %s", utils.SetupProjectName,
		)
		t.Logf("[discovery] switched to setup project %s", utils.SetupProjectName)
	}

	dp := pages.NewDiscoveryPage(f.Page)
	return f, dp
}

// createFreshFileServer always creates a new NFS file server with a unique
// timestamped name, attaches a worker, and waits until the server transitions
// to Active (export paths retrieved, Bulk Discover button enabled).
//
// sourceHost overrides config.SourceHost when non-empty (used for cloned volumes).
func createFreshFileServer(t *testing.T, f *fixtures.AuthFixture, sourceHost string) (fsID string, fsName string) {
	t.Helper()
	if sourceHost == "" {
		sourceHost = config.SourceHost
	}
	requireEnv(t, sourceHost, "NDM_SOURCE_HOST")

	fsName = fmt.Sprintf("test-fs-%d", time.Now().UnixMilli())
	t.Logf("[setup] creating fresh file server %q on host %s", fsName, sourceHost)

	fsp := pages.NewFileServerPage(f.Page)
	var err error
	fsID, err = fsp.CreateNFSFileServer(
		fsName,
		sourceHost,
		config.ProtocolUsername,
		config.ProtocolPassword,
		config.MinWorkers,
	)
	require.NoError(t, err, "create NFS file server via wizard")
	t.Logf("[setup] created file server %s (ID: %s) — waiting for Active…", fsName, fsID)

	require.NoError(t,
		fsp.WaitForFileServerActive(fsID, 180000),
		"file server did not become active within 3 minutes",
	)
	t.Logf("[setup] file server %s is now Active", fsName)
	return fsID, fsName
}

// createFreshIsilonFileServer creates a new Dell PowerScale (Isilon) file
// server with a unique timestamped name, attaches a worker, and waits for Active.
func createFreshIsilonFileServer(t *testing.T, f *fixtures.AuthFixture) (fsID string, fsName string) {
	t.Helper()

	fsName = fmt.Sprintf("test-isilon-%d", time.Now().UnixMilli())
	t.Logf("[setup] creating fresh Isilon file server %q on host %s", fsName, config.IsilonHost)

	fsp := pages.NewFileServerPage(f.Page)
	var err error
	fsID, err = fsp.CreateIsilonFileServer(
		fsName,
		config.IsilonHost,
		config.IsilonMgmtUsername,
		config.IsilonMgmtPassword,
		config.IsilonNfsIP,
		config.IsilonNfsUsername,
		config.MinWorkers,
	)
	require.NoError(t, err, "create Isilon file server via wizard")
	t.Logf("[setup] created Isilon file server %s (ID: %s) — waiting for Active…", fsName, fsID)

	require.NoError(t,
		fsp.WaitForFileServerActive(fsID, 180000),
		"Isilon file server did not become active within 3 minutes",
	)
	t.Logf("[setup] Isilon file server %s is now Active", fsName)
	return fsID, fsName
}

// createFreshSMBFileServer creates a new SMB file server with a unique
// timestamped name, attaches a worker, and waits until the server transitions
// to Active.
//
// smbHost overrides config.SMBHost when non-empty (used for cloned volumes).
func createFreshSMBFileServer(t *testing.T, f *fixtures.AuthFixture, smbHost string) (fsID string, fsName string) {
	t.Helper()
	if smbHost == "" {
		smbHost = config.SMBHost
	}
	requireEnv(t, smbHost, "NDM_SMB_HOST")
	requireEnv(t, config.SMBUsername, "NDM_SMB_USERNAME")
	requireEnv(t, config.SMBPassword, "NDM_SMB_PASSWORD")

	fsName = fmt.Sprintf("test-smb-%d", time.Now().UnixMilli())
	t.Logf("[setup] creating fresh SMB file server %q on host %s", fsName, smbHost)

	fsp := pages.NewFileServerPage(f.Page)
	var err error
	fsID, err = fsp.CreateSMBFileServer(
		fsName,
		smbHost,
		config.SMBAdServerIP,
		config.SMBUsername,
		config.SMBPassword,
		config.MinWorkers,
	)
	require.NoError(t, err, "create SMB file server via wizard")
	t.Logf("[setup] created SMB file server %s (ID: %s) — waiting for Active…", fsName, fsID)

	require.NoError(t,
		fsp.WaitForFileServerActive(fsID, 180000),
		"SMB file server did not become active within 3 minutes",
	)
	t.Logf("[setup] SMB file server %s is now Active", fsName)
	return fsID, fsName
}

// runBulkDiscovery opens file server → bulk discover form → fills → submits.
// Captures job config IDs before/after submit via API to identify the new job.
// Returns the new job config ID.
func runBulkDiscovery(
	t *testing.T,
	dp *pages.DiscoveryPage,
	f *fixtures.AuthFixture,
	fileServerID string,
	protocol string,
	exportPath string,
	selectAll bool,
	beforeSubmit func(t *testing.T, dp *pages.DiscoveryPage),
) string {
	t.Helper()

	// Capture existing job config IDs before submit.
	beforeIDs := dp.FetchAllJobIDs("discovery")

	require.NoError(t,
		dp.NavigateToFileServerOverview(fileServerID),
		"navigate to file server overview",
	)
	require.NoError(t, dp.OpenBulkDiscoverForm(), "open bulk discover form")

	if protocol != "" {
		require.NoError(t, dp.SelectProtocol(protocol), "select protocol "+protocol)
	}

	require.NoError(t, dp.SetScheduleStartNow(), "set schedule to Start Now")

	if beforeSubmit != nil {
		beforeSubmit(t, dp)
	}

	if selectAll {
		require.NoError(t, dp.SelectAllExportPaths(), "select all export paths")
	} else if exportPath != "" {
		if err := dp.SelectExportPathByName(exportPath); err != nil {
			// The specific path was not found in the table (e.g. ANF NFS export
			// not yet visible). Fall back to selecting ALL paths — this always
			// leaves the Submit button enabled. SelectFirstNRows was previously
			// used here but left the form in an invalid state (Submit disabled).
			t.Logf("[discovery] %v — falling back to select all export paths", err)
			require.NoError(t, dp.SelectAllExportPaths(),
				"fallback: select all export paths")
		}
	}

	f.Screenshot("before-submit")
	require.NoError(t, dp.SubmitBulkDiscovery(), "submit bulk discovery")
	t.Log("[discovery] bulk discover job submitted")
	fmt.Printf("[DISCOVERY SUBMITTED] fileServer=%s protocol=%s\n", fileServerID, protocol)

	// Diff job IDs to find the newly created config.
	afterIDs := dp.FetchAllJobIDs("discovery")
	newIDs := pages.DiffJobIDs(beforeIDs, afterIDs)
	if len(newIDs) == 0 {
		t.Log("[discovery] WARNING: no new job config detected via API diff, using empty ID")
		return ""
	}
	configID := newIDs[0]
	t.Logf("[discovery] new job config ID: %s", configID)
	return configID
}

// waitForDiscoveryCompletion uses the jobs API to wait for the run to
// appear and reach COMPLETED status. Falls back to UI polling if no
// config ID is available.
func waitForDiscoveryCompletion(
	t *testing.T,
	dp *pages.DiscoveryPage,
	f *fixtures.AuthFixture,
	configID string,
	timeout float64,
) {
	t.Helper()

	if configID != "" {
		// API-based polling — much more reliable than UI table counting.
		_, err := dp.WaitForRunToAppear(configID, 120)
		require.NoError(t, err, "run did not appear via API")

		require.NoError(t,
			dp.WaitForJobState(configID, "completed", int(timeout/1000)),
			"discovery job did not complete",
		)
		return
	}

	// Fallback: UI-based polling.
	require.NoError(t, dp.NavigateToJobRunList(), "navigate to job run list")
	require.NoError(t,
		dp.WaitForJobRunStatus("COMPLETED", timeout),
		"discovery job did not complete",
	)
}

// navigateToRunListAndWaitForStatus uses API polling to wait for a specific
// status, then navigates to the Job Run List UI so action buttons (Pause,
// Stop, Resume) are available for subsequent steps.
// Returns the actual status reached (may be "completed" if the job finished
// before the desired state could be observed).
func navigateToRunListAndWaitForStatus(
	t *testing.T,
	dp *pages.DiscoveryPage,
	f *fixtures.AuthFixture,
	configID string,
	desired string,
	timeout float64,
) string {
	t.Helper()

	actualStatus := strings.ToLower(desired)

	if configID != "" {
		_, err := dp.WaitForRunToAppear(configID, 120)
		require.NoError(t, err, "run did not appear via API")

		err = dp.WaitForJobState(configID, strings.ToLower(desired), int(timeout/1000))
		if err != nil {
			// Check if the job already completed (race condition for fast jobs).
			status, pollErr := dp.PollJob(configID)
			if pollErr == nil && (status.Status == "completed" || status.Status == "stopped") {
				t.Logf("[navigateToRunList] job already reached %s before %s could be observed",
					status.Status, desired)
				actualStatus = status.Status
			} else {
				require.NoError(t, err, fmt.Sprintf("job did not reach %s state", desired))
			}
		}
	} else {
		require.NoError(t, dp.NavigateToJobRunList(), "navigate to job run list")
		require.NoError(t,
			dp.WaitForJobRunStatus(desired, timeout),
			fmt.Sprintf("job did not reach %s state", desired),
		)
	}

	require.NoError(t, dp.NavigateToJobRunList(), "navigate to job run list UI")
	f.Screenshot("job-run-list-" + strings.ToLower(desired))
	return actualStatus
}

// ═════════════════════════════════════════════════════════════════════════════
// 5.1  Basic Discovery (NFS)
// ═════════════════════════════════════════════════════════════════════════════

func TestDiscovery_BasicNFS(t *testing.T) {
	t.Parallel()
	clone := resolveNFSClone(t)
	requireEnv(t, clone.hostIP, "NDM_SOURCE_HOST")
	requireEnv(t, clone.exportPath, "NDM_NFS_EXPORT_PATH")

	f, dp := newDiscoveryFixture(t)
	defer f.Close()

	fsID, _ := createFreshFileServer(t, f, clone.hostIP)
	waitForCloneExport(t, dp, fsID, clone)

	configID := runBulkDiscovery(t, dp, f, fsID, "NFS", clone.exportPath, false, nil)
	waitForDiscoveryCompletion(t, dp, f, configID, config.DiscoveryTimeoutMs)

	f.Screenshot("after-completion")

	visible, err := dp.IsReportVisible()
	require.NoError(t, err)
	t.Logf("[5.1] report visible = %t", visible)

	// ── Validate report against the actual volume ─────────────────────────
	// Download the individual discovery report CSV that was just generated,
	// mount the NFS volume locally, and compare report counts with live data.
	require.NoError(t, dp.NavigateToJobRunList(), "navigate to Job Run List for CSV download")

	t.Log("[5.1] downloading discovery report CSV")
	csvPath, err := dp.DownloadDiscoveryReportFromJobRunList(downloadDir(t), 0)
	require.NoError(t, err, "download discovery report CSV")
	t.Logf("[5.1] report CSV: %s", csvPath)

	exportPath := clone.exportPath
	if !strings.HasPrefix(exportPath, "/") {
		exportPath = "/" + exportPath
	}
	nfsExport := fmt.Sprintf("%s:%s", clone.hostIP, exportPath)
	t.Logf("[5.1] validating report against live volume %s", nfsExport)

	result, err := utils.ValidateReport(utils.ReportTypeDiscovery, utils.ProtocolNFS, csvPath, nfsExport, "")
	require.NoError(t, err, "validate discovery report against live NFS volume")
	require.True(t, result.Match,
		"[5.1] discovery report does not match live volume:\n%s", result)

	t.Logf("[5.1] report validation: %s", result)
	fmt.Println("[DISCOVERY 5.1 PASSED] Basic NFS discovery completed — report validated against live volume")
}

// ═════════════════════════════════════════════════════════════════════════════
// 5.2  Basic Discovery (SMB)
// ═════════════════════════════════════════════════════════════════════════════

func TestDiscovery_BasicSMB(t *testing.T) {
	t.Parallel()
	clone := resolveSMBClone(t)
	requireEnv(t, clone.hostIP, "NDM_SMB_HOST")
	requireEnv(t, clone.exportPath, "NDM_SMB_SHARE")
	requireEnv(t, config.SMBAdServerIP, "NDM_SMB_AD_SERVER_IP")
	requireEnv(t, config.SMBUsername, "NDM_SMB_USERNAME")
	requireEnv(t, config.SMBPassword, "NDM_SMB_PASSWORD")
	requireEnv(t, config.SMBWorkerHost, "NDM_SMB_WORKER_HOST")
	// AZURE_AD_SMB_SOURCE_HOST_IP is checked inside validateSMBDiscovery.

	f, dp := newDiscoveryFixture(t)
	defer f.Close()

	fsID, _ := createFreshSMBFileServer(t, f, clone.hostIP)
	waitForCloneExport(t, dp, fsID, clone)

	configID := runBulkDiscovery(t, dp, f, fsID, "SMB", clone.exportPath, false, nil)
	waitForDiscoveryCompletion(t, dp, f, configID, config.DiscoveryTimeoutMs)

	f.Screenshot("after-completion")

	visible, _ := dp.IsReportVisible()
	t.Logf("[5.2] report visible = %t", visible)

	// ── Validate report against the actual SMB share ──────────────────────
	// Download the discovery report CSV and compare its file/dir counts
	// against a live PowerShell scan of the share from the Windows scan host.
	// Credentials are read from env vars inside ValidateReport (same pattern
	// as NFS, which uses the local machine for mounting).
	require.NoError(t, dp.NavigateToJobRunList(), "navigate to Job Run List for CSV download")

	t.Log("[5.2] downloading discovery report CSV")
	csvPath, err := dp.DownloadDiscoveryReportFromJobRunList(downloadDir(t), 0)
	require.NoError(t, err, "download SMB discovery report CSV")
	t.Logf("[5.2] report CSV: %s", csvPath)

	// src format: \\smbHost\shareName  (parsed by validateSMBDiscovery)
	smbSrc := fmt.Sprintf(`\\%s\%s`, clone.hostIP, clone.exportPath)
	t.Logf("[5.2] validating report against live SMB share %s via AD server %s",
		smbSrc, config.SMBAdServerIP)

	result, err := utils.ValidateReport(utils.ReportTypeDiscovery, utils.ProtocolSMB, csvPath, smbSrc, "")
	require.NoError(t, err, "validate SMB discovery report against live share")
	require.True(t, result.Match,
		"[5.2] SMB discovery report does not match live share:\n%s", result)

	t.Logf("[5.2] report validation: %s", result)
	fmt.Println("[DISCOVERY 5.2 PASSED] Basic SMB discovery completed — report validated against live share")
}

// ═════════════════════════════════════════════════════════════════════════════
// 5.4  Discovery with ExcludeFilePatterns
// ═════════════════════════════════════════════════════════════════════════════

func TestDiscovery_ExcludeFilePatterns(t *testing.T) {
	t.Parallel()
	clone := resolveNFSClone(t)
	requireEnv(t, clone.hostIP, "NDM_SOURCE_HOST")
	requireEnv(t, clone.exportPath, "NDM_NFS_EXPORT_PATH")

	f, dp := newDiscoveryFixture(t)
	defer f.Close()

	fsID, _ := createFreshFileServer(t, f, clone.hostIP)
	waitForCloneExport(t, dp, fsID, clone)

	customPatterns := "*/-snapshot/*\n*/.snapshot/*\n*.tmp\n*.log\n*.bak"

	configID := runBulkDiscovery(t, dp, f, fsID, "NFS", clone.exportPath, false,
		func(t *testing.T, dp *pages.DiscoveryPage) {
			t.Helper()
			require.NoError(t,
				dp.SetExcludeFilePatterns(customPatterns),
				"set custom exclude file patterns",
			)
		},
	)
	waitForDiscoveryCompletion(t, dp, f, configID, config.DiscoveryTimeoutMs)

	t.Log("[5.4] discovery with custom exclude patterns completed")
	fmt.Println("[DISCOVERY 5.4 PASSED] Discovery with ExcludeFilePatterns completed")
}

// ═════════════════════════════════════════════════════════════════════════════
// 5.6  Bulk Discovery (multiple source paths)
// ═════════════════════════════════════════════════════════════════════════════

func TestDiscovery_Bulk(t *testing.T) {
	t.Parallel()
	clone := resolveNFSClone(t)
	requireEnv(t, clone.hostIP, "NDM_SOURCE_HOST")

	f, dp := newDiscoveryFixture(t)
	defer f.Close()

	fsID, _ := createFreshFileServer(t, f, clone.hostIP)
	waitForCloneExport(t, dp, fsID, clone)

	// Select all paths exposed on this host (which now includes the cloned volume).
	configID := runBulkDiscovery(t, dp, f, fsID, "NFS", "", true, nil)
	waitForDiscoveryCompletion(t, dp, f, configID, config.DiscoveryTimeoutMs)

	f.Screenshot("bulk-after-completion")
	t.Log("[5.6] bulk discovery completed for all NFS export paths")
	fmt.Println("[DISCOVERY 5.6 PASSED] Bulk discovery for multiple source paths completed")
}

// ═════════════════════════════════════════════════════════════════════════════
// 5.16  Discovery on Destination
// ═════════════════════════════════════════════════════════════════════════════

func TestDiscovery_Destination(t *testing.T) {
	t.Parallel()
	requireEnv(t, config.DestinationFileServerID, "NDM_DESTINATION_FILE_SERVER_ID")

	f, dp := newDiscoveryFixture(t)
	defer f.Close()

	configID := runBulkDiscovery(t, dp, f, config.DestinationFileServerID, "NFS", "", true, nil)
	waitForDiscoveryCompletion(t, dp, f, configID, config.DiscoveryTimeoutMs)

	t.Log("[5.16] destination discovery completed — baseline report generated")
	fmt.Println("[DISCOVERY 5.16 PASSED] Discovery on destination server completed")
}

// ═════════════════════════════════════════════════════════════════════════════
// 5.18  Discovery on Isilon
// ═════════════════════════════════════════════════════════════════════════════

func TestDiscovery_Isilon(t *testing.T) {
	t.Parallel()
	requireEnv(t, config.IsilonHost, "NDM_ISILON_HOST")
	requireEnv(t, config.IsilonMgmtPassword, "NDM_ISILON_MGMT_PASSWORD")
	requireEnv(t, config.IsilonNfsIP, "NDM_ISILON_NFS_IP")

	f, dp := newDiscoveryFixture(t)
	defer f.Close()

	// Isilon is a separate file server type; volume cloning does not apply.
	fsID, _ := createFreshIsilonFileServer(t, f)

	// Verify Isilon overview shows auto-listed export paths.
	require.NoError(t,
		dp.NavigateToFileServerOverview(fsID),
		"navigate to Isilon file server overview",
	)
	f.Page.WaitForTimeout(3000)

	snapshotVisible, _ := f.Page.Locator(`text=.snapshot`).First().IsVisible()
	require.False(t, snapshotVisible,
		".snapshot should be excluded from Isilon export paths")

	// Submit bulk discovery for all paths.
	configID := runBulkDiscovery(t, dp, f, fsID, "NFS", "", true, nil)
	waitForDiscoveryCompletion(t, dp, f, configID, config.DiscoveryTimeoutMs)

	f.Screenshot("isilon-after-completion")
	t.Log("[5.18] Isilon discovery completed — paths auto-listed, .snapshot excluded")
	fmt.Println("[DISCOVERY 5.18 PASSED] Discovery on Isilon completed")
}

// ═════════════════════════════════════════════════════════════════════════════
// 5.20  Individual Discovery Report CSV (per job run)
//
// Prerequisite: at least one completed discovery on the file server.
// Downloads the discovery report CSV from the Job Run List overflow menu
// (⋯ → "Download Discovery Report as CSV") for a single completed run.
// ═════════════════════════════════════════════════════════════════════════════

func TestDiscovery_IndividualReportCSV(t *testing.T) {
	t.Parallel()
	fsID := config.FileServerID
	if fsID == "" {
		t.Skip("skipping: NDM_FILE_SERVER_ID is not set — required for standalone parallel run")
	}
	t.Logf("[5.20] using file server %s", fsID)

	f, dp := newDiscoveryFixture(t)
	defer f.Close()

	t.Log("[5.20] navigating to Job Run List")
	require.NoError(t, dp.NavigateToJobRunList(), "navigate to Job Run List")
	f.Screenshot("individual-report-job-run-list")

	t.Log("[5.20] downloading individual discovery report CSV from overflow menu")
	csvPath, err := dp.DownloadDiscoveryReportFromJobRunList(downloadDir(t), 0)
	require.NoError(t, err, "download individual discovery report CSV")
	f.Screenshot("individual-report-downloaded")

	info, statErr := os.Stat(csvPath)
	require.NoError(t, statErr, "CSV file should exist at %s", csvPath)
	require.Greater(t, info.Size(), int64(0), "CSV file should not be empty")
	require.True(t,
		strings.HasSuffix(csvPath, ".csv") || strings.HasSuffix(csvPath, ".zip"),
		"downloaded file should have .csv or .zip extension, got: %s", csvPath,
	)

	t.Logf("[5.20] individual report CSV downloaded: %s (%d bytes)", csvPath, info.Size())
	fmt.Println("[DISCOVERY 5.20 PASSED] Individual Discovery Report CSV downloaded and verified")
}

// ═════════════════════════════════════════════════════════════════════════════
// 5.19  Consolidated Discovery Report (CSV)
//
// Prerequisite: at least one completed discovery on the file server.
// Automatically uses the file server created by an earlier test in the suite
// (e.g. TestDiscovery_BasicNFS). Falls back to NDM_FILE_SERVER_ID for
// standalone runs.
// ═════════════════════════════════════════════════════════════════════════════

func TestDiscovery_ConsolidatedCSV(t *testing.T) {
	t.Parallel()
	fsID := config.FileServerID
	if fsID == "" {
		t.Skip("skipping: NDM_FILE_SERVER_ID is not set — required for standalone parallel run")
	}
	t.Logf("[5.19] using file server %s", fsID)

	f, dp := newDiscoveryFixture(t)
	defer f.Close()

	t.Log("[5.19] navigating to file server overview")
	require.NoError(t,
		dp.NavigateToFileServerOverview(fsID),
		"navigate to file server overview",
	)
	f.Screenshot("fs-overview-for-csv")

	t.Log("[5.19] triggering consolidated CSV generation and downloading")
	csvPath, err := dp.GenerateAndDownloadConsolidatedCSV(downloadDir(t), 300000)
	require.NoError(t, err, "generate and download consolidated CSV")

	f.Screenshot("csv-download-complete")

	info, statErr := os.Stat(csvPath)
	require.NoError(t, statErr, "CSV file should exist at %s", csvPath)
	require.Greater(t, info.Size(), int64(0), "CSV file should not be empty")
	require.True(t,
		strings.HasSuffix(csvPath, ".csv"),
		"downloaded file should have .csv extension, got: %s", csvPath,
	)

	t.Logf("[5.19] CSV downloaded: %s (%d bytes)", csvPath, info.Size())
	fmt.Println("[DISCOVERY 5.19 PASSED] Consolidated Discovery Report CSV downloaded and verified")
}

// ═════════════════════════════════════════════════════════════════════════════
// 5.21  Validate Discovery Report against actual volume data
//
// Downloads the individual discovery report CSV, then SSHes into the worker,
// mounts the NFS volume read-only, counts real files/dirs, and compares
// the totals against the report. Zero diff = report is accurate.
// ═════════════════════════════════════════════════════════════════════════════

func TestDiscovery_ValidateReportAgainstVolume(t *testing.T) {
	t.Parallel()
	// Resolve host and export path — uses a clone if cloning is enabled.
	clone := resolveNFSClone(t)
	requireEnv(t, clone.hostIP, "NDM_SOURCE_HOST")
	requireEnv(t, clone.exportPath, "NDM_NFS_EXPORT_PATH")

	fsID := config.FileServerID
	if fsID == "" {
		t.Skip("skipping: NDM_FILE_SERVER_ID is not set — required for standalone parallel run")
	}
	t.Logf("[5.21] using file server %s", fsID)

	// ── Step 1: download report CSV via browser ──
	f, dp := newDiscoveryFixture(t)
	defer f.Close()

	require.NoError(t, dp.NavigateToJobRunList(), "navigate to Job Run List")

	t.Log("[5.21] downloading individual discovery report CSV")
	csvPath, err := dp.DownloadDiscoveryReportFromJobRunList(downloadDir(t), 0)
	require.NoError(t, err, "download discovery report CSV")
	t.Logf("[5.21] report downloaded: %s", csvPath)

	// ── Step 2: mount NFS volume locally on the runner and scan ──
	exportPath := clone.exportPath
	if !strings.HasPrefix(exportPath, "/") {
		exportPath = "/" + exportPath
	}
	nfsExport := fmt.Sprintf("%s:%s", clone.hostIP, exportPath)
	t.Logf("[5.21] scanning volume %s locally on runner", nfsExport)

	scan, err := utils.LocalScanNFSVolumeForDiscovery(nfsExport)
	require.NoError(t, err, "scan NFS volume for discovery metadata")
	t.Logf("[5.21] volume scan: total=%d, files=%d, dirs=%d, symlinks=%d",
		scan.TotalCount, scan.RegularFilesCount, scan.DirectoriesCount, scan.SymlinksCount)

	// ── Step 3: compare ──
	diffs, err := utils.CompareDiscoveryReport(csvPath, scan)
	require.NoError(t, err, "compare discovery report with volume scan")

	if len(diffs) > 0 {
		for _, d := range diffs {
			t.Logf("[5.21] DIFF: %s", d)
		}
		t.Fatalf("[5.21] discovery report does not match actual volume data: %d differences", len(diffs))
	}

	t.Log("[5.21] discovery report matches actual volume data — zero diff")
	fmt.Println("[DISCOVERY 5.21 PASSED] Report validated against real volume data")
}

// ═════════════════════════════════════════════════════════════════════════════
// 5.22  Job Config Details — Summary vs Run History Consistency
//
// Validates that the "Summary of Last Run" cards on the Job Config Details
// page match the latest row in the Run History table:
//   - Files count in summary = Files in latest Run History row
//   - Size in summary = Size in latest Run History row
//   - Latest Errors (N) in summary = Errors in latest Run History row
// ═════════════════════════════════════════════════════════════════════════════

func TestDiscovery_JobConfigSummaryConsistency(t *testing.T) {
	t.Parallel()
	clone := resolveNFSClone(t)
	requireEnv(t, clone.hostIP, "NDM_SOURCE_HOST")
	requireEnv(t, clone.exportPath, "NDM_NFS_EXPORT_PATH")

	f, dp := newDiscoveryFixture(t)
	defer f.Close()

	// ── 1. Create file server and run discovery ──────────────────────────────
	By(t, "Creating file server and running discovery")
	fsID, _ := createFreshFileServer(t, f, clone.hostIP)
	waitForCloneExport(t, dp, fsID, clone)

	configID := runBulkDiscovery(t, dp, f, fsID, "NFS", clone.exportPath, false, nil)
	waitForDiscoveryCompletion(t, dp, f, configID, config.DiscoveryTimeoutMs)
	t.Logf("[5.22] discovery completed (config: %s)", configID)

	// ── 2. Navigate to Job Config Details ────────────────────────────────────
	By(t, "Navigating to Job Config Details")
	mp := pages.NewMigrationPage(f.Page, "d522")
	require.NoError(t, mp.NavigateToJobConfigDetails(configID),
		"navigate to job config details")
	f.Screenshot("d522-job-config-details")

	// ── 3. Read the summary section ──────────────────────────────────────────
	By(t, "Reading Job Config Summary")
	summary, err := mp.GetJobConfigSummary()
	require.NoError(t, err, "read job config summary")
	t.Logf("[5.22] summary: files=%s size=%s errors=%s",
		summary.Files, summary.Size, summary.Errors)

	// ── 4. Read the Run History table ────────────────────────────────────────
	By(t, "Reading Run History table")
	mp.ClickRunHistoryTab()
	f.Screenshot("d522-run-history-table")

	rows, err := mp.GetRunHistoryRows()
	require.NoError(t, err, "read run history rows")
	require.NotEmpty(t, rows, "run history table should have at least one row")
	t.Logf("[5.22] run history: %d row(s), latest: files=%s size=%s errors=%s status=%s",
		len(rows), rows[0].Files, rows[0].Size, rows[0].Errors, rows[0].Status)

	latestRow := rows[0]

	// ── 5. Validate: Summary Files = Latest Row Files ────────────────────────
	By(t, "Validating summary Files matches latest run Files")
	require.Equal(t, summary.Files, latestRow.Files,
		"summary Files (%s) should match latest Run History row Files (%s)",
		summary.Files, latestRow.Files)

	// ── 6. Validate: Summary Size = Latest Row Size ──────────────────────────
	By(t, "Validating summary Size matches latest run Size")
	require.Equal(t, summary.Size, latestRow.Size,
		"summary Size (%s) should match latest Run History row Size (%s)",
		summary.Size, latestRow.Size)

	// ── 7. Validate: Latest Errors count = Latest Row Errors ─────────────────
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

	t.Log("[5.22] all summary vs Run History validations passed")
	fmt.Printf("[5.22] files=%s size=%s errors=%s\n", summary.Files, summary.Size, summary.Errors)
	fmt.Println("[DISCOVERY 5.22 PASSED] Job Config Details summary is consistent with Run History")
}
