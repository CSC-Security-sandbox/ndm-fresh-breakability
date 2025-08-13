# Firefox Browser Testing Setup

This guide explains how to run your NetApp Data Migrator UI tests specifically with Firefox browser.

## Prerequisites

Firefox should be automatically installed when you run `npx playwright install`. Playwright will manage the Firefox installation for you.

If you want to use your system Firefox:

- **macOS**: Firefox is usually installed in `/Applications/Firefox.app`
- **Windows**: Usually in `C:\Program Files\Mozilla Firefox\firefox.exe`
- **Linux**: Usually available via package manager or in `/usr/bin/firefox`

## Firefox Browser Commands

### Run all tests with Firefox browser

```bash
npm run test:firefox
```

### Run tests with Firefox browser in headed mode (visible browser)

```bash
npm run test:firefox:headed
```

### Debug tests with Firefox browser

```bash
npm run test:firefox:debug
```

### Run specific test file with Firefox

```bash
npx playwright test tests/example.spec.ts --project=firefox
```

### Run specific test with Firefox in headed mode

```bash
npx playwright test tests/bulk-migration.spec.ts --headed --project=firefox
```

## Configuration

The Firefox browser configuration is defined in `playwright.config.ts`:

```typescript
{
  name: "firefox",
  use: { ...devices["Desktop Firefox"] },
}
```

This configuration:

- Uses the Firefox engine (Gecko)
- Provides cross-browser compatibility testing
- Uses Playwright's managed Firefox installation by default

## Firefox-Specific Features

When testing with Firefox, you can take advantage of:

1. **Different Rendering Engine**: Gecko vs Chromium provides real cross-browser testing
2. **Memory Management**: Firefox often has different memory characteristics
3. **CSS Compatibility**: Different CSS rendering and support
4. **JavaScript Engine**: SpiderMonkey vs V8 differences
5. **Security Features**: Enhanced tracking protection and privacy features

## Testing Strategy

Consider using Firefox browser tests for:

- **Cross-Browser Compatibility**: Ensure your app works across different browser engines
- **CSS/Layout Testing**: Different rendering engines may show layout issues
- **JavaScript Compatibility**: Different JS engines may reveal compatibility issues
- **Performance Differences**: Firefox may perform differently than Chromium-based browsers
- **Standards Compliance**: Firefox often follows web standards strictly

## Examples

### Basic Firefox Test Run

```bash
# Run smoke tests with Firefox
npm run test:firefox:headed
```

### Debugging with Firefox

```bash
# Debug a specific test with Firefox
npx playwright test tests/file-server-management.spec.ts --debug --project=firefox
```

### Generate Report for Firefox Tests

```bash
# Run tests and generate HTML report
npm run test:firefox
npm run test:report
```

## Troubleshooting

### Firefox Not Found

If you get "Firefox browser not found" error:

1. Run `npx playwright install firefox` to install Playwright's Firefox
2. Make sure Firefox installation completed successfully
3. Check if system Firefox is in PATH (if using system Firefox)

### Tests Failing Only in Firefox

If tests pass in Chrome but fail in Firefox:

1. Check for browser-specific CSS issues
2. Look for JavaScript compatibility problems
3. Verify vendor prefixes for CSS properties
4. Check timing differences (Firefox may be faster/slower)
5. Review browser console for errors specific to Firefox

### Common Firefox Issues

- **CSS Grid/Flexbox**: Slight differences in implementation
- **ES6+ Features**: Different support levels for newer JavaScript features
- **WebGL/Canvas**: Different graphics capabilities
- **File Upload**: Different file handling behavior
- **WebSocket**: Different connection handling

## Performance Benefits

Firefox testing provides:

- **True Cross-Browser Coverage**: Different engine than Chrome/Safari
- **Memory Usage Patterns**: Different memory management
- **Rendering Performance**: Different optimization strategies
- **Standards Compliance**: Often more strict adherence to web standards

## Continuous Integration

To include Firefox in your CI/CD pipeline:

```yaml
- name: Install Playwright with Firefox
  run: |
    npm ci
    npx playwright install firefox

- name: Run Firefox Tests
  run: npm run test:firefox
```

## Browser Comparison Strategy

Run tests across multiple browsers for comprehensive coverage:

```bash
# Run tests on all browsers
npm test

# Run specific test across browsers
npx playwright test tests/example.spec.ts --project=chromium --project=firefox --project=webkit

# Compare performance across browsers
npm run test:firefox
npm run test:chrome
npm run test:report
```
