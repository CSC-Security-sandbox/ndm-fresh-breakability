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

// Auto-mock the WinShellService to prevent shell creation issues during tests
// Don't mock the service for its own tests
const testFile = process.env.JEST_CURRENT_TEST_FILE || '';

// We'll still mock WinShellService for all tests except its own direct tests
// This resolves the shell creation issues while allowing other tests to run correctly
if (!testFile.includes('win-shell.service.spec.ts')) {
  // Create a full mock of WinShellService with all required methods
  jest.mock('src/activities/common/win-shell.service', () => {
    let adminMode = false;
    
    return {
      WinShellService: jest.fn().mockImplementation(() => ({
        // Core functionality
        executeCommand: jest.fn().mockResolvedValue({ stdout: 'mocked stdout', stderr: '' }),
        addShellAtIndex: jest.fn().mockResolvedValue(undefined),
        createShellPool: jest.fn().mockResolvedValue(undefined),
        replaceShell: jest.fn(),
        getShellFromPool: jest.fn().mockReturnValue({
          execCommand: jest.fn().mockResolvedValue({ stdout: 'mocked stdout', stderr: '' })
        }),
        
        // Lifecycle methods
        onModuleInit: jest.fn().mockResolvedValue(undefined),
        onModuleDestroy: jest.fn().mockResolvedValue(undefined),
        
        // Additional functionality
        executeInFreshShell: jest.fn().mockResolvedValue({ stdout: 'mocked stdout', stderr: '' }),
        isAdminModeEnabled: jest.fn().mockImplementation(() => adminMode),
        setAdminMode: jest.fn().mockImplementation((value) => { adminMode = value; }),
        
        // Statistics and metrics
        getExecutionTimeStats: jest.fn().mockReturnValue({ 
          avgTime: 0, minTime: 0, maxTime: 0, totalTime: 0, samples: 0, slowCommands: 0
        }),
        getStats: jest.fn().mockReturnValue({ 
          totalExecuted: 0, totalErrors: 0, averageExecutionTime: 0,
          poolSize: 3, successRate: 100, queues: []
        }),
        getAclPerformanceAnalysis: jest.fn().mockReturnValue({ 
          totalOperations: 0, avgTime: 0, minTime: 0, maxTime: 0, performanceRating: 'No data'
        }),
      }))
    };
  });
} else {
  console.log('Skipping WinShellService mock for its own test file');
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
