# NetApp Data Migrator - UI Tests

This directory contains UI test for the NetApp Data Migrator application using Playwright with Firefox browser.

## Test Structure

### Test Files

- **example.spec.ts** - Login form verification test

## Quick Start

### Prerequisites

- Node.js (v14 or later)
- Firefox browser installed
- NetApp Data Migrator application running on `http://localhost:3111`

### Installation

```bash
npm install
```

### Running Tests

```bash
# Run all tests (Firefox only)
npm test

# Run tests in headed mode (visible browser)
npm run test:headed

# Run with debug mode
npm run test:debug

# View test report
npm run test:report

# Install Firefox browser
npm run install-browsers
```

### Test Description

The test suite includes:

- **Login Form Test**: Verifies that the login page displays correctly with all required elements:
  - Username input field
  - Password input field
  - Submit button
  - Welcome message
  - "Log in to Data Migrator" text

## Configuration

- **Browser**: Firefox only
- **Base URL**: http://localhost:3111
- **Retries**: 2 attempts on failure
- **Timeout**: 30 seconds per test
- **Screenshots**: Captured on failure
- **Videos**: Recorded on failure

## Project Structure

```
ndm-ui-tests/
├── tests/
│   └── example.spec.ts          # Login form test
├── playwright.config.ts         # Test configuration
├── package.json                 # Dependencies
└── README.md                    # This file
```

## Troubleshooting

### Common Issues

1. **Application not running**: Ensure the NetApp Data Migrator app is running on port 3111
2. **Firefox not found**: Install Firefox browser if not already installed
3. **SSL errors**: The configuration handles HTTPS issues automatically

### Test Reports

After running tests, view the HTML report:

```bash
npx playwright show-report
```

## Development

### Adding New Tests

To add new test cases, edit `tests/example.spec.ts`:

```typescript
test("new test case", async ({ page }) => {
  // Your test code here
});
```

### Configuration Changes

Modify `playwright.config.ts` to adjust timeouts, retries, or other settings.
