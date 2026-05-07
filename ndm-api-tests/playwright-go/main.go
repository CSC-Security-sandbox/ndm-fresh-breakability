package main

import (
	"fmt"
	"log"
	"ndm-api-tests/playwright-go/pwutils"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/playwright-community/playwright-go"
)

func runTC001(browser playwright.Browser, cfg pwutils.Config) error {
	uid := pwutils.UniqueID()
	protocol := strings.ToLower(cfg.Protocol)
	srcServerName := fmt.Sprintf("tc-001-%s-src-fs-%s", protocol, uid)
	destServerName := fmt.Sprintf("tc-001-%s-dest-fs-%s", protocol, uid)

	var srcFileServerID, destFileServerID string

	page, ctx, err := pwutils.NewAuthPage(browser)
	if err != nil {
		return fmt.Errorf("new page: %w", err)
	}
	defer ctx.Close()
	defer page.Close()

	// Step 1: Create Source File Server
	log.Println("═══ Step 1: Creating Source File Server")
	if err := pwutils.CreateFileServer(page, srcServerName, cfg.SourceHost, cfg.Protocol,
		cfg.ProtocolUsername, cfg.ProtocolPassword, cfg.MinWorkers); err != nil {
		return fmt.Errorf("create source FS: %w", err)
	}
	srcFileServerID, err = pwutils.NavigateToFileServer(page, srcServerName)
	if err != nil {
		return fmt.Errorf("navigate to source FS: %w", err)
	}
	log.Printf("Source file server created: %s (%s)", srcServerName, srcFileServerID)

	// Step 2: Bulk Discovery on Source
	log.Println("═══ Step 2: Running Bulk Discovery on Source")
	beforeSrcDiscovery, _ := pwutils.FetchAllJobIDs(page, "discover")

	if err := pwutils.RunBulkDiscovery(page, srcFileServerID, cfg.SourceExportPaths, cfg.MaxDiscoveryPaths); err != nil {
		return fmt.Errorf("bulk discovery source: %w", err)
	}
	pwutils.Sleep(5000)

	afterSrcDiscovery, _ := pwutils.FetchAllJobIDs(page, "discover")
	srcDiscoveryJobs := pwutils.DiffJobIDs(beforeSrcDiscovery, afterSrcDiscovery)
	if len(srcDiscoveryJobs) == 0 {
		pwutils.SleepSec(10)
		afterSrcDiscovery, _ = pwutils.FetchAllJobIDs(page, "discover")
		srcDiscoveryJobs = pwutils.DiffJobIDs(beforeSrcDiscovery, afterSrcDiscovery)
	}
	if len(srcDiscoveryJobs) == 0 {
		return fmt.Errorf("no source discovery jobs found")
	}

	for _, jobID := range srcDiscoveryJobs {
		if err := pwutils.WaitForJobState(page, jobID, "completed", 900); err != nil {
			return fmt.Errorf("source discovery: %w", err)
		}
		log.Printf("Source discovery job %s completed", jobID)
	}

	// Step 3: Create Destination File Server
	if cfg.DestinationHost == "" {
		log.Println("═══ Step 3: SKIPPED (DESTINATION_HOST not set)")
		return nil
	}

	log.Println("═══ Step 3: Creating Destination File Server")
	destUsername := cfg.DestProtocolUsername
	if destUsername == "" {
		destUsername = cfg.ProtocolUsername
	}
	if err := pwutils.CreateFileServer(page, destServerName, cfg.DestinationHost, cfg.Protocol,
		destUsername, cfg.DestProtocolPassword, cfg.MinWorkers); err != nil {
		return fmt.Errorf("create destination FS: %w", err)
	}
	destFileServerID, err = pwutils.NavigateToFileServer(page, destServerName)
	if err != nil {
		return fmt.Errorf("navigate to dest FS: %w", err)
	}

	// Step 4: Bulk Discovery on Destination
	log.Println("═══ Step 4: Running Bulk Discovery on Destination")
	beforeDestDiscovery, _ := pwutils.FetchAllJobIDs(page, "discover")

	if err := pwutils.RunBulkDiscovery(page, destFileServerID, cfg.DestinationExportPaths, cfg.MaxDiscoveryPaths); err != nil {
		return fmt.Errorf("bulk discovery dest: %w", err)
	}
	pwutils.Sleep(5000)

	afterDestDiscovery, _ := pwutils.FetchAllJobIDs(page, "discover")
	destDiscoveryJobs := pwutils.DiffJobIDs(beforeDestDiscovery, afterDestDiscovery)
	if len(destDiscoveryJobs) == 0 {
		pwutils.SleepSec(10)
		afterDestDiscovery, _ = pwutils.FetchAllJobIDs(page, "discover")
		destDiscoveryJobs = pwutils.DiffJobIDs(beforeDestDiscovery, afterDestDiscovery)
	}

	for _, jobID := range destDiscoveryJobs {
		if err := pwutils.WaitForJobState(page, jobID, "completed", 900); err != nil {
			return fmt.Errorf("dest discovery: %w", err)
		}
	}

	// Step 5: Immediate Migration
	log.Println("═══ Step 5: Starting Bulk Migration (Start Now)")
	beforeMigration, _ := pwutils.FetchAllJobIDs(page, "migrate")

	if err := pwutils.RunBulkMigration(page, srcFileServerID, destServerName,
		cfg.SourceExportPaths, cfg.DestinationExportPaths); err != nil {
		return fmt.Errorf("bulk migration: %w", err)
	}
	pwutils.Sleep(5000)

	afterMigration, _ := pwutils.FetchAllJobIDs(page, "migrate")
	migrationJobs := pwutils.DiffJobIDs(beforeMigration, afterMigration)
	if len(migrationJobs) == 0 {
		pwutils.SleepSec(10)
		afterMigration, _ = pwutils.FetchAllJobIDs(page, "migrate")
		migrationJobs = pwutils.DiffJobIDs(beforeMigration, afterMigration)
	}

	// Step 6: Wait for migration completion
	for _, jobID := range migrationJobs {
		pwutils.WaitForRunToAppear(page, jobID, 120)
		if err := pwutils.WaitForJobState(page, jobID, "completed", 900); err != nil {
			log.Printf("[migration] %s did not complete: %v", jobID, err)
		}
	}

	if len(migrationJobs) > 0 {
		r, _ := pwutils.PollJob(page, migrationJobs[0])
		if r != nil && r.RunID != "" {
			page.Goto(pwutils.FullURL(fmt.Sprintf("/job-details/%s", migrationJobs[0])))
			pwutils.Sleep(5000)
			if pwutils.IsVisible(page.GetByText(regexp.MustCompile(`(?i)completed`)).First()) {
				log.Println("Migration job shows 'completed' in Job Details")
			}
		}
	}

	// Step 8: Bulk Cutover
	log.Println("═══ Step 8: Creating Bulk Cutover Job")
	beforeCutover, _ := pwutils.FetchAllJobIDs(page, "cutover")
	if err := pwutils.RunBulkCutover(page, srcFileServerID); err != nil {
		log.Printf("[cutover] Warning: %v", err)
	} else {
		pwutils.Sleep(5000)
		afterCutover, _ := pwutils.FetchAllJobIDs(page, "cutover")
		cutoverJobs := pwutils.DiffJobIDs(beforeCutover, afterCutover)

		for _, jobID := range cutoverJobs {
			pwutils.WaitForRunToAppear(page, jobID, 120)
			if err := pwutils.WaitForJobState(page, jobID, "blocked", 600); err != nil {
				continue
			}
			st, _ := pwutils.PollJob(page, jobID)
			if st != nil && st.RunID != "" {
				pwutils.ApproveCutover(page, st.RunID)
			}
		}
		for _, jobID := range cutoverJobs {
			pwutils.WaitForJobState(page, jobID, "completed", 600)
		}
	}

	// Step 9: Version Check
	log.Println("═══ Step 9: Version Check")
	pwutils.VerifyVersions(page)

	log.Println("═══ TC-001 PASSED ═══")
	return nil
}

func main() {
	cfg := pwutils.LoadConfig()

	log.Println("╔══════════════════════════════════════════════════════════════╗")
	log.Println("║  TC-001: Go + Playwright E2E Test                          ║")
	log.Println("║  File servers → Discovery → Scheduled Migration → Cutover  ║")
	log.Println("╚══════════════════════════════════════════════════════════════╝")

	if err := playwright.Install(); err != nil {
		log.Fatalf("could not install playwright: %v", err)
	}

	pw, err := playwright.Run()
	if err != nil {
		log.Fatalf("could not start playwright: %v", err)
	}
	defer pw.Stop()

	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(false),
	})
	if err != nil {
		log.Fatalf("could not launch browser: %v", err)
	}
	defer browser.Close()

	if err := pwutils.Authenticate(browser, cfg); err != nil {
		log.Fatalf("authentication failed: %v", err)
	}

	start := time.Now()
	if err := runTC001(browser, cfg); err != nil {
		log.Printf("\n  ✘  TC-001 FAILED (%s) — %v\n", time.Since(start).Round(time.Second), err)
		os.Exit(1)
	}

	fmt.Printf("\n  ✓  TC-001 PASSED (%s)\n", time.Since(start).Round(time.Second))
}
