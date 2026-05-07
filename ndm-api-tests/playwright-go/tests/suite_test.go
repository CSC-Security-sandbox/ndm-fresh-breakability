package tests

import (
	"log"
	"ndm-api-tests/playwright-go/pwutils"
	"testing"

	"github.com/playwright-community/playwright-go"
)

var (
	Cfg     pwutils.Config
	PW      *playwright.Playwright
	Browser playwright.Browser
)

func TestMain(m *testing.M) {
	Cfg = pwutils.LoadConfig()

	log.Println("╔══════════════════════════════════════════════════════════════╗")
	log.Println("║  NDM Playwright Go E2E Tests                               ║")
	log.Println("╚══════════════════════════════════════════════════════════════╝")
	log.Printf("  Base URL:            %s", Cfg.BaseURL)
	log.Printf("  Source Host:         %s", Cfg.SourceHost)
	log.Printf("  Destination Host:    %s", Cfg.DestinationHost)
	log.Printf("  Protocol:            %s", Cfg.Protocol)
	log.Printf("  Min Workers:         %d", Cfg.MinWorkers)
	log.Printf("  Max Discovery Paths: %d", Cfg.MaxDiscoveryPaths)
	log.Printf("  Schedule Delay:      %ds", Cfg.ScheduleDelaySec)

	if err := playwright.Install(); err != nil {
		log.Fatalf("could not install playwright: %v", err)
	}

	pw, err := playwright.Run()
	if err != nil {
		log.Fatalf("could not start playwright: %v", err)
	}
	PW = pw

	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(false),
	})
	if err != nil {
		log.Fatalf("could not launch browser: %v", err)
	}
	Browser = browser

	if err := pwutils.Authenticate(Browser, Cfg); err != nil {
		log.Fatalf("authentication failed: %v", err)
	}

	exitCode := m.Run()

	Browser.Close()
	PW.Stop()

	if exitCode != 0 {
		log.Fatalf("Tests failed with exit code %d", exitCode)
	}
}
