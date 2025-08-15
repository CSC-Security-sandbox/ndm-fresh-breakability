// Jest setup file to handle worker threads and DataCloneError issues

// Disable worker threads for tests that involve services with child processes
// This prevents DataCloneError when Jest tries to serialize services with ChildProcess objects
if (process.env.JEST_WORKER_ID !== undefined) {
  // Check if current test file involves shell services
  const testFile = process.env.JEST_CURRENT_TEST_FILE || '';
  if (testFile.includes('stamp-meta.service.spec.ts')) {
    // Force this test to run in main thread
    process.env.JEST_WORKER_THREADS = 'false';
  }
}

// Mock console methods to reduce noise in test output
global.console = {
  ...console,
  // Suppress specific log messages during tests
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
