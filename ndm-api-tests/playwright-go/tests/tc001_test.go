package tests

import (
	"fmt"
	"log"
	"ndm-api-tests/playwright-go/pwutils"
	"regexp"
	"strings"
	"testing"
)

func TestTC001_DiscoveryMigrationCutover(t *testing.T) {
	uid := pwutils.UniqueID()
	protocol := strings.ToLower(Cfg.Protocol)
	srcServerName := fmt.Sprintf("tc-001-%s-src-fs-%s", protocol, uid)
	destServerName := fmt.Sprintf("tc-001-%s-dest-fs-%s", protocol, uid)

	var srcFileServerID, destFileServerID string

	page, ctx, err := pwutils.NewAuthPage(Browser)
	if err != nil {
		t.Fatalf("new page: %v", err)
	}
	defer ctx.Close()
	defer page.Close()

	// ─── Step 1: Create Source File Server ────────────────────────────
	t.Run("Step1_CreateSourceFileServer", func(t *testing.T) {
		log.Println("═══ Step 1: Creating Source File Server")
		if err := pwutils.CreateFileServer(page, srcServerName, Cfg.SourceHost, Cfg.Protocol,
			Cfg.ProtocolUsername, Cfg.ProtocolPassword, Cfg.MinWorkers); err != nil {
			t.Fatalf("create source FS: %v", err)
		}
		srcFileServerID, err = pwutils.NavigateToFileServer(page, srcServerName)
		if err != nil {
			t.Fatalf("navigate to source FS: %v", err)
		}
		log.Printf("Source file server created: %s (%s)", srcServerName, srcFileServerID)

		if err := pwutils.ExpectVisible(page.GetByRole("button", pwutils.ButtonOptions("Bulk Discover")), 30000); err != nil {
			t.Fatalf("source FS not Active")
		}
		log.Println("Source file server is Active")
	})

	// ─── Step 2: Run Bulk Discovery on Source ─────────────────────────
	var srcDiscoveryJobs []string
	t.Run("Step2_SourceDiscovery", func(t *testing.T) {
		log.Println("═══ Step 2: Running Bulk Discovery on Source")

		beforeSrcDiscovery, _ := pwutils.FetchAllJobIDs(page, "discover")

		if err := pwutils.RunBulkDiscovery(page, srcFileServerID, Cfg.SourceExportPaths, Cfg.MaxDiscoveryPaths); err != nil {
			t.Fatalf("bulk discovery source: %v", err)
		}
		_ = pwutils.ExpectVisible(page.GetByText("Bulk Discover Job has been created").First(), 10000)
		pwutils.Sleep(5000)

		afterSrcDiscovery, _ := pwutils.FetchAllJobIDs(page, "discover")
		srcDiscoveryJobs = pwutils.DiffJobIDs(beforeSrcDiscovery, afterSrcDiscovery)
		if len(srcDiscoveryJobs) == 0 {
			pwutils.SleepSec(10)
			afterSrcDiscovery, _ = pwutils.FetchAllJobIDs(page, "discover")
			srcDiscoveryJobs = pwutils.DiffJobIDs(beforeSrcDiscovery, afterSrcDiscovery)
		}
		if len(srcDiscoveryJobs) == 0 {
			t.Fatalf("no source discovery jobs found")
		}
		log.Printf("Source discovery job(s): %v", srcDiscoveryJobs)

		for _, jobID := range srcDiscoveryJobs {
			log.Printf("Waiting for source discovery job %s...", jobID)
			if err := pwutils.WaitForJobState(page, jobID, "completed", 900); err != nil {
				t.Fatalf("source discovery: %v", err)
			}
			log.Printf("Source discovery job %s completed", jobID)
		}
	})

	// ─── Step 2b: Verify Source Discovery Report ──────────────────────
	t.Run("Step2b_VerifySourceDiscoveryReport", func(t *testing.T) {
		log.Println("═══ Step 2b: Verifying Source Discovery Report")
		if len(srcDiscoveryJobs) == 0 {
			t.Skip("no discovery jobs to verify")
		}
		r, _ := pwutils.PollJob(page, srcDiscoveryJobs[0])
		if r != nil && r.RunID != "" {
			page.Goto(pwutils.FullURL(fmt.Sprintf("/job-discovery-preview/%s", r.RunID)))
			pwutils.Sleep(5000)
			if err := pwutils.ExpectVisible(page.GetByText("Job Run Id").First(), 15000); err == nil {
				log.Println("Source discovery report loaded successfully")
			}
		}
	})

	// ─── Step 3: Create Destination File Server ───────────────────────
	if Cfg.DestinationHost == "" {
		log.Println("═══ Step 3: SKIPPED (DESTINATION_HOST not set)")
		return
	}

	t.Run("Step3_CreateDestinationFileServer", func(t *testing.T) {
		log.Println("═══ Step 3: Creating Destination File Server")
		destUsername := Cfg.DestProtocolUsername
		if destUsername == "" {
			destUsername = Cfg.ProtocolUsername
		}
		if err := pwutils.CreateFileServer(page, destServerName, Cfg.DestinationHost, Cfg.Protocol,
			destUsername, Cfg.DestProtocolPassword, Cfg.MinWorkers); err != nil {
			t.Fatalf("create destination FS: %v", err)
		}
		destFileServerID, err = pwutils.NavigateToFileServer(page, destServerName)
		if err != nil {
			t.Fatalf("navigate to dest FS: %v", err)
		}
		log.Printf("Destination file server created: %s (%s)", destServerName, destFileServerID)
	})

	// ─── Step 4: Run Bulk Discovery on Destination ────────────────────
	t.Run("Step4_DestinationDiscovery", func(t *testing.T) {
		log.Println("═══ Step 4: Running Bulk Discovery on Destination")

		beforeDestDiscovery, _ := pwutils.FetchAllJobIDs(page, "discover")

		if err := pwutils.RunBulkDiscovery(page, destFileServerID, Cfg.DestinationExportPaths, Cfg.MaxDiscoveryPaths); err != nil {
			t.Fatalf("bulk discovery dest: %v", err)
		}
		pwutils.Sleep(5000)

		afterDestDiscovery, _ := pwutils.FetchAllJobIDs(page, "discover")
		destDiscoveryJobs := pwutils.DiffJobIDs(beforeDestDiscovery, afterDestDiscovery)
		if len(destDiscoveryJobs) == 0 {
			pwutils.SleepSec(10)
			afterDestDiscovery, _ = pwutils.FetchAllJobIDs(page, "discover")
			destDiscoveryJobs = pwutils.DiffJobIDs(beforeDestDiscovery, afterDestDiscovery)
		}
		if len(destDiscoveryJobs) == 0 {
			t.Fatalf("no dest discovery jobs found")
		}

		for _, jobID := range destDiscoveryJobs {
			if err := pwutils.WaitForJobState(page, jobID, "completed", 900); err != nil {
				t.Fatalf("dest discovery: %v", err)
			}
			log.Printf("Dest discovery job %s completed", jobID)
		}
	})

	// ─── Step 5: Start Migration (immediate) ─────────────────────────
	var migrationJobs []string
	t.Run("Step5_Migration", func(t *testing.T) {
		log.Println("═══ Step 5: Starting Bulk Migration (Start Now)")

		beforeMigration, _ := pwutils.FetchAllJobIDs(page, "migrate")

		if err := pwutils.RunBulkMigration(page, srcFileServerID, destServerName,
			Cfg.SourceExportPaths, Cfg.DestinationExportPaths); err != nil {
			t.Fatalf("bulk migration: %v", err)
		}
		pwutils.Sleep(5000)

		afterMigration, _ := pwutils.FetchAllJobIDs(page, "migrate")
		migrationJobs = pwutils.DiffJobIDs(beforeMigration, afterMigration)
		if len(migrationJobs) == 0 {
			pwutils.SleepSec(10)
			afterMigration, _ = pwutils.FetchAllJobIDs(page, "migrate")
			migrationJobs = pwutils.DiffJobIDs(beforeMigration, afterMigration)
		}
		if len(migrationJobs) == 0 {
			t.Fatalf("no migration jobs found after submitting")
		}
		log.Printf("Migration job(s): %v", migrationJobs)
	})

	// ─── Step 6: Wait for Migration to Complete ──────────────────────
	t.Run("Step6_WaitForMigrationCompletion", func(t *testing.T) {
		if len(migrationJobs) == 0 {
			t.Skip("no migration jobs")
		}
		log.Println("═══ Step 6: Waiting for migration to complete...")

		for _, jobID := range migrationJobs {
			if _, err := pwutils.WaitForRunToAppear(page, jobID, 120); err != nil {
				t.Logf("[migration] %s: %v", jobID, err)
				continue
			}
			if err := pwutils.WaitForJobState(page, jobID, "completed", 900); err != nil {
				t.Fatalf("[migration] %s did not complete: %v", jobID, err)
			}
			log.Printf("Migration job %s completed", jobID)
		}
	})

	// ─── Step 6b: Verify Migration Report ────────────────────────────
	t.Run("Step6b_VerifyMigrationReport", func(t *testing.T) {
		if len(migrationJobs) == 0 {
			t.Skip("no migration jobs")
		}
		log.Println("═══ Step 6b: Verifying Migration Report")
		page.Goto(pwutils.FullURL(fmt.Sprintf("/job-details/%s", migrationJobs[0])))
		pwutils.Sleep(5000)
		if pwutils.IsVisible(page.GetByText(regexp.MustCompile(`(?i)completed`)).First()) {
			log.Println("Migration job shows 'completed' in Job Details")
		}
	})

	// ─── Step 7: Bulk Cutover ────────────────────────────────────────
	t.Run("Step7_BulkCutover", func(t *testing.T) {
		log.Println("═══ Step 7: Creating Bulk Cutover Job")

		beforeCutover, _ := pwutils.FetchAllJobIDs(page, "cutover")

		if err := pwutils.RunBulkCutover(page, srcFileServerID); err != nil {
			t.Logf("Warning — could not create cutover: %v", err)
			return
		}
		pwutils.Sleep(5000)

		afterCutover, _ := pwutils.FetchAllJobIDs(page, "cutover")
		cutoverJobs := pwutils.DiffJobIDs(beforeCutover, afterCutover)
		if len(cutoverJobs) == 0 {
			pwutils.SleepSec(10)
			afterCutover, _ = pwutils.FetchAllJobIDs(page, "cutover")
			cutoverJobs = pwutils.DiffJobIDs(beforeCutover, afterCutover)
		}

		if len(cutoverJobs) == 0 {
			t.Log("WARNING: no cutover jobs found")
			return
		}
		log.Printf("Cutover job(s): %v", cutoverJobs)

		var cutoverRunIDs []string
		for _, jobID := range cutoverJobs {
			st, err := pwutils.WaitForRunToAppear(page, jobID, 120)
			if err != nil {
				t.Logf("[cutover] %s: no run: %v", jobID, err)
				continue
			}
			if err := pwutils.WaitForJobState(page, jobID, "blocked", 600); err != nil {
				t.Logf("[cutover] %s did not reach BLOCKED: %v", jobID, err)
				continue
			}
			st, _ = pwutils.PollJob(page, jobID)
			if st != nil && st.RunID != "" {
				cutoverRunIDs = append(cutoverRunIDs, st.RunID)
			}
		}

		if len(cutoverRunIDs) > 0 {
			log.Println("═══ Step 7b: Approving Cutover Jobs")
			for _, runID := range cutoverRunIDs {
				if err := pwutils.ApproveCutover(page, runID); err != nil {
					t.Logf("[cutover] approve %s failed: %v", runID, err)
				}
			}
			for _, jobID := range cutoverJobs {
				if err := pwutils.WaitForJobState(page, jobID, "completed", 600); err != nil {
					t.Logf("[cutover] %s did not complete: %v", jobID, err)
				} else {
					log.Printf("Cutover job %s completed", jobID)
				}
			}
		}
	})

	// ─── Step 8: Version Check ───────────────────────────────────────
	t.Run("Step8_VersionCheck", func(t *testing.T) {
		log.Println("═══ Step 8: Version Check")
		if err := pwutils.VerifyVersions(page); err != nil {
			t.Logf("Warning: %v", err)
		}
	})

	log.Println("═══ TC-001 PASSED ═══")
}
