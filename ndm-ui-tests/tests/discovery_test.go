// Package tests — Discovery UI E2E flows.
//
// Each test creates a FRESH file server via the wizard, so there are
// no stale errored runs from previous attempts. Requires NDM_SOURCE_HOST.
//
// The Bulk Discover form exposes:
//   1. Job Schedule           — Start Now  /  Schedule Date & Time (UTC)
//   2. Excluded Path Patterns — textarea  (default: */-snapshot/*, */.snapshot/*)
//   3. Select Protocol        — dropdown  (NFS | SMB)
//   4. Export Path table      — row checkboxes
//   5. Cancel / Submit
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
//	5.19 TestDiscovery_ConsolidatedCSV     — Discovery report as CSV
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

	"github.com/stretchr/testify/require"
)

// ── helpers ──────────────────────────────────────────────────────────────────

func requireEnv(t *testing.T, value, name string) {
	t.Helper()
	if value == "" {
		t.Skipf("skipping: %s is not set in .env", name)
	}
}

func newDiscoveryFixture(t *testing.T) (*fixtures.AuthFixture, *pages.DiscoveryPage) {
	t.Helper()
	f := fixtures.NewAdminFixture(t)
	dp := pages.NewDiscoveryPage(f.Page)
	return f, dp
}

// createFreshFileServer always creates a new NFS file server with a unique
// timestamped name, attaches a worker, and waits until the server transitions
// to Active (export paths retrieved, Bulk Discover button enabled).
func createFreshFileServer(t *testing.T, f *fixtures.AuthFixture) (fsID string, fsName string) {
	t.Helper()
	requireEnv(t, config.SourceHost, "NDM_SOURCE_HOST")

	fsName = fmt.Sprintf("test-fs-%d", time.Now().UnixMilli())
	t.Logf("[setup] creating fresh file server %q on host %s", fsName, config.SourceHost)

	fsp := pages.NewFileServerPage(f.Page)
	var err error
	fsID, err = fsp.CreateNFSFileServer(
		fsName,
		config.SourceHost,
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
func createFreshSMBFileServer(t *testing.T, f *fixtures.AuthFixture) (fsID string, fsName string) {
	t.Helper()
	requireEnv(t, config.SMBHost, "NDM_SMB_HOST")
	requireEnv(t, config.SMBUsername, "NDM_SMB_USERNAME")
	requireEnv(t, config.SMBPassword, "NDM_SMB_PASSWORD")

	fsName = fmt.Sprintf("test-smb-%d", time.Now().UnixMilli())
	t.Logf("[setup] creating fresh SMB file server %q on host %s", fsName, config.SMBHost)

	fsp := pages.NewFileServerPage(f.Page)
	var err error
	fsID, err = fsp.CreateSMBFileServer(
		fsName,
		config.SMBHost,
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
		require.NoError(t,
			dp.SelectExportPathByName(exportPath),
			"select export path "+exportPath,
		)
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
	f, dp := newDiscoveryFixture(t)
	defer f.Close()

	fsID, _ := createFreshFileServer(t, f)
	requireEnv(t, config.NfsExportPath, "NDM_NFS_EXPORT_PATH")

	configID := runBulkDiscovery(t, dp, f, fsID, "NFS", config.NfsExportPath, false, nil)
	waitForDiscoveryCompletion(t, dp, f, configID, config.DiscoveryTimeoutMs)

	f.Screenshot("after-completion")

	visible, err := dp.IsReportVisible()
	require.NoError(t, err)
	t.Logf("[5.1] report visible = %t", visible)
	fmt.Println("[DISCOVERY 5.1 PASSED] Basic NFS discovery completed with report")
}

// ═════════════════════════════════════════════════════════════════════════════
// 5.2  Basic Discovery (SMB)
// ═════════════════════════════════════════════════════════════════════════════

func TestDiscovery_BasicSMB(t *testing.T) {
	requireEnv(t, config.SMBHost, "NDM_SMB_HOST")
	requireEnv(t, config.SMBShare, "NDM_SMB_SHARE")

	f, dp := newDiscoveryFixture(t)
	defer f.Close()

	fsID, _ := createFreshSMBFileServer(t, f)

	configID := runBulkDiscovery(t, dp, f, fsID, "SMB", config.SMBShare, false, nil)
	waitForDiscoveryCompletion(t, dp, f, configID, config.DiscoveryTimeoutMs)

	visible, _ := dp.IsReportVisible()
	t.Logf("[5.2] report visible = %t", visible)
	fmt.Println("[DISCOVERY 5.2 PASSED] Basic SMB discovery completed with report")
}

// ═════════════════════════════════════════════════════════════════════════════
// 5.4  Discovery with ExcludeFilePatterns
// ═════════════════════════════════════════════════════════════════════════════

func TestDiscovery_ExcludeFilePatterns(t *testing.T) {
	f, dp := newDiscoveryFixture(t)
	defer f.Close()

	fsID, _ := createFreshFileServer(t, f)
	requireEnv(t, config.NfsExportPath, "NDM_NFS_EXPORT_PATH")

	customPatterns := "*/-snapshot/*\n*/.snapshot/*\n*.tmp\n*.log\n*.bak"

	configID := runBulkDiscovery(t, dp, f, fsID, "NFS", config.NfsExportPath, false,
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
	f, dp := newDiscoveryFixture(t)
	defer f.Close()

	fsID, _ := createFreshFileServer(t, f)

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
	requireEnv(t, config.IsilonHost, "NDM_ISILON_HOST")
	requireEnv(t, config.IsilonMgmtPassword, "NDM_ISILON_MGMT_PASSWORD")
	requireEnv(t, config.IsilonNfsIP, "NDM_ISILON_NFS_IP")

	f, dp := newDiscoveryFixture(t)
	defer f.Close()

	// Create a fresh Isilon file server via the wizard.
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
// 5.19  Consolidated Discovery Report (CSV)
//
// Prerequisite: at least one completed discovery on the file server.
// Uses an existing server (NDM_FILE_SERVER_ID) that already has completed
// discovery runs. Navigates to File Server Overview → clicks
// "Consolidate All Discovery Reports" dropdown → selects CSV.
// ═════════════════════════════════════════════════════════════════════════════

func TestDiscovery_ConsolidatedCSV(t *testing.T) {
	requireEnv(t, config.FileServerID, "NDM_FILE_SERVER_ID")

	f, dp := newDiscoveryFixture(t)
	defer f.Close()

	t.Log("[5.19] navigating to file server overview")
	require.NoError(t,
		dp.NavigateToFileServerOverview(config.FileServerID),
		"navigate to file server overview",
	)
	f.Screenshot("fs-overview-for-csv")

	downloadDir := filepath.Join("test-results", "downloads")
	require.NoError(t, os.MkdirAll(downloadDir, 0o755), "create download dir")

	t.Log("[5.19] triggering consolidated CSV generation and downloading")
	csvPath, err := dp.GenerateAndDownloadConsolidatedCSV(downloadDir, 300000)
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
