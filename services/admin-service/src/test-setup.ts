// Global test setup for admin-service
// This file sets up environment variables for all tests to prevent file system permission issues

// Set test environment variables before any modules are loaded
process.env.NODE_ENV = 'test';
process.env.SERVICE = 'admin-service';
process.env.LOG_DIR = './logs'
process.env.LOG_LEVEL = 'info'; // Minimal logging during tests
process.env.ENABLE_FILE_LOGGING = 'false'; // Enable file logging in tests
process.env.ENABLE_CONSOLE_LOGGING = 'false'; // Keep console logging for test feedback
process.env.LOG_MAX_FILES = '7d'; // Shorter retention for tests
process.env.LOG_MAX_SIZE = '10m'; // Smaller files for tests
process.env.LOG_DATE_PATTERN = 'YYYY-MM-DD'; // Standard daily rotation
process.env.LOG_ZIPPED_ARCHIVE = 'false'; // No compression for tests (faster)
process.env.CI = 'true'; // Indicate this is a CI/test environment

// Mock console methods to reduce test output noise
const originalConsoleLog   = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

// Only show errors during tests unless explicitly enabled
if (!process.env.VERBOSE_TESTS) {
  console.log = jest.fn();
  console.warn = jest.fn();
  // Keep console.error for actual test failures
}

// Clean up after tests
afterAll(() => {
  if (!process.env.VERBOSE_TESTS) {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }
});