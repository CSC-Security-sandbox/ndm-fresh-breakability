package pwutils

import (
	"log"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/playwright-community/playwright-go"
)

func Sleep(ms int)   { time.Sleep(time.Duration(ms) * time.Millisecond) }
func SleepSec(s int) { time.Sleep(time.Duration(s) * time.Second) }

func UniqueID() string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 8)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}

func Screenshot(page playwright.Page, name string) {
	_ = os.MkdirAll("test-results", 0o755)
	path := filepath.Join("test-results", name+".png")
	data, err := page.Screenshot(playwright.PageScreenshotOptions{FullPage: playwright.Bool(true)})
	if err == nil {
		_ = os.WriteFile(path, data, 0o644)
		log.Printf("[screenshot] saved: %s", path)
	}
}

func ExpectVisible(loc playwright.Locator, timeoutMs float64) error {
	return loc.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(timeoutMs),
	})
}

func IsVisible(loc playwright.Locator) bool {
	v, err := loc.IsVisible()
	return err == nil && v
}

func IsEnabled(loc playwright.Locator) bool {
	e, err := loc.IsEnabled()
	return err == nil && e
}

func TextContent(loc playwright.Locator) string {
	t, _ := loc.TextContent()
	return t
}

func ButtonOptions(name string) playwright.PageGetByRoleOptions {
	return playwright.PageGetByRoleOptions{Name: name}
}

func GotoWithRetry(page playwright.Page, url string, attempts int) {
	for i := 0; i < attempts; i++ {
		page.Goto(url, playwright.PageGotoOptions{
			Timeout:   playwright.Float(60000),
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		})
		Sleep(3000)
		if strings.Contains(page.URL(), strings.TrimPrefix(url, BaseURL)) {
			return
		}
		Sleep(2000)
	}
}
