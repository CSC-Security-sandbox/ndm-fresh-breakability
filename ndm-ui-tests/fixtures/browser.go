package fixtures

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"ndm-ui-tests/config"

	"github.com/playwright-community/playwright-go"
)

// BrowserFixture holds a Playwright browser context and page.
type BrowserFixture struct {
	PW      *playwright.Playwright
	Browser playwright.BrowserContext // persistent context (used as both browser+context)
	Page    playwright.Page
	T       *testing.T
}

// NewBrowser initialises Playwright and opens a page using system Chrome.
// Uses LaunchPersistentContext so Playwright can manage the user-data-dir
// correctly when a custom Chrome executable is specified.
func NewBrowser(t *testing.T) *BrowserFixture {
	t.Helper()

	pw, err := playwright.Run()
	if err != nil {
		t.Fatalf("failed to start Playwright: %v", err)
	}

	// Isolated temp profile — avoids conflict with already-running Chrome.
	tmpDir, err := os.MkdirTemp("", "ndm-pw-chrome-*")
	if err != nil {
		t.Fatalf("failed to create temp Chrome profile: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(tmpDir) })

	_ = os.MkdirAll(config.VideoDir, 0o755)
	_ = os.MkdirAll(config.ScreenshotDir, 0o755)

	opts := playwright.BrowserTypeLaunchPersistentContextOptions{
		Headless:          playwright.Bool(config.Headless),
		SlowMo:            playwright.Float(config.SlowMo),
		IgnoreHttpsErrors: playwright.Bool(true),
		Args: []string{
			"--ignore-certificate-errors",
			"--ignore-ssl-errors",
			"--disable-web-security",
			"--no-sandbox",
		},
		RecordVideo: &playwright.RecordVideo{
			Dir: config.VideoDir,
		},
	}

	// Use system Chrome if available (inherits macOS network / VPN / proxy)
	chromePath := resolveChromePath()
	if chromePath != "" {
		t.Logf("using Chrome at: %s", chromePath)
		opts.ExecutablePath = playwright.String(chromePath)
	}

	ctx, err := pw.Chromium.LaunchPersistentContext(tmpDir, opts)
	if err != nil {
		t.Fatalf("failed to launch browser: %v", err)
	}

	// Use the first page (already created by LaunchPersistentContext)
	var page playwright.Page
	if pages := ctx.Pages(); len(pages) > 0 {
		page = pages[0]
	} else {
		page, err = ctx.NewPage()
		if err != nil {
			t.Fatalf("failed to get page: %v", err)
		}
	}

	page.SetDefaultTimeout(config.Timeout)

	return &BrowserFixture{
		PW:      pw,
		Browser: ctx,
		Page:    page,
		T:       t,
	}
}

// Screenshot saves a full-page screenshot. It always captures when called
// directly (e.g. on error, before a require/assert). The video-on-failure
// logic lives in Close(), not here.
func (f *BrowserFixture) Screenshot(name string) {
	path := fmt.Sprintf("%s/%s-%s.png", config.ScreenshotDir, sanitise(f.T.Name()), name)
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	if _, err := f.Page.Screenshot(playwright.PageScreenshotOptions{
		Path:     playwright.String(path),
		FullPage: playwright.Bool(true),
	}); err != nil {
		f.T.Logf("warning: screenshot failed: %v", err)
		return
	}
	f.T.Logf("screenshot → %s", path)
}

// Close stops the browser. Video kept on failure, deleted on success.
// Safe to call multiple times — subsequent calls are no-ops.
func (f *BrowserFixture) Close() {
	if f.PW == nil {
		return // already closed
	}

	var video playwright.Video
	if f.Page != nil {
		video = f.Page.Video()
	}

	_ = f.Browser.Close() // finalises the video file
	_ = f.PW.Stop()
	f.PW = nil // mark as closed

	if video == nil {
		return
	}
	rawPath, pathErr := video.Path()
	if pathErr != nil || rawPath == "" {
		return
	}

	if f.T.Failed() {
		named := fmt.Sprintf("%s/%s.webm", config.VideoDir, sanitise(f.T.Name()))
		if err := os.Rename(rawPath, named); err == nil {
			rawPath = named
		}
		f.T.Logf("video → %s", rawPath)
	} else {
		_ = os.Remove(rawPath)
	}
}

// resolveChromePath returns the Chrome executable to use, or "" for bundled Chromium.
func resolveChromePath() string {
	if p := os.Getenv("NDM_CHROME_PATH"); p != "" {
		return p
	}
	macPath := "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
	if _, err := os.Stat(macPath); err == nil {
		return macPath
	}
	for _, p := range []string{"/usr/bin/google-chrome", "/usr/bin/chromium-browser"} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// sanitise replaces characters invalid in filenames.
func sanitise(s string) string {
	invalid := `/\:*?"<>|`
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		bad := false
		for j := 0; j < len(invalid); j++ {
			if c == invalid[j] {
				bad = true
				break
			}
		}
		if bad {
			out = append(out, '_')
		} else {
			out = append(out, c)
		}
	}
	return string(out)
}
