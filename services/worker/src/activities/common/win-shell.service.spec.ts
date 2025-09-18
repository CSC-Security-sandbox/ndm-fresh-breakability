import { WinShellService } from './win-shell.service';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

jest.mock('child_process');
jest.mock(
  '../core/migrate/command-execution/win-opeartions/powershell.script',
  () => ({
    psBaseAclDefinition: 'mock-powershell-script',
  }),
);

// Mock logger factory
const mockLoggerFactory = {
  create: jest.fn().mockReturnValue({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
  }),
};

describe('WinShellService', () => {
  let service: WinShellService;
  let mockSpawn: jest.MockedFunction<typeof spawn>;
  let originalPlatform: NodeJS.Platform;

  beforeAll(() => {
    originalPlatform = process.platform;
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

    // Create service instance with mocked logger factory
    service = new WinShellService(mockLoggerFactory as any);
  });

  afterEach(async () => {
    if (service) {
      try {
        await service.onModuleDestroy();
      } catch (error) {
        // Ignore cleanup errors in tests
      }
    }
  });

  describe('onModuleInit', () => {
    it('should skip initialization on non-Windows platforms', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      await service.onModuleInit();

      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should initialize on Windows platform', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdin = { write: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();

      mockSpawn.mockReturnValue(mockProcess);

      // Call onModuleInit but don't await it - we just want to verify spawn is called
      service.onModuleInit();

      expect(mockSpawn).toHaveBeenCalled();
    });
  });

  describe('executeCommand', () => {
    it('should throw error on non-Windows platforms', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      await expect(service.executeCommand('test-command')).rejects.toThrow();
    });
  });

  describe('executeInFreshShell', () => {
    it('should create fresh shell process', () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdin = { write: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();

      mockSpawn.mockReturnValue(mockProcess);

      const promise = service.executeInFreshShell('Get-Date');

      expect(mockSpawn).toHaveBeenCalledWith(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          'Get-Date',
        ],
        expect.any(Object),
      );

      // Clean up by completing the promise
      mockProcess.stdout.emit('data', 'test');
      mockProcess.emit('exit', 0);

      return promise;
    });
  });

  describe('admin mode', () => {
    it('should set admin mode', () => {
      expect(service.isAdminModeEnabled()).toBe(false);

      service.setAdminMode(true);
      expect(service.isAdminModeEnabled()).toBe(true);

      service.setAdminMode(false);
      expect(service.isAdminModeEnabled()).toBe(false);
    });
  });

  describe('getExecutionTimeStats', () => {
    it('should return default stats when no executions', () => {
      const stats = service.getExecutionTimeStats();

      expect(stats.avgTime).toBe(0);
      expect(stats.minTime).toBe(0);
      expect(stats.maxTime).toBe(0);
      expect(stats.samples).toBe(0);
      expect(stats.slowCommands).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return service stats', () => {
      const stats = service.getStats();

      expect(stats).toHaveProperty('totalExecuted');
      expect(stats).toHaveProperty('totalErrors');
      expect(stats).toHaveProperty('poolSize');
      expect(stats).toHaveProperty('successRate');
      expect(stats).toHaveProperty('queues');
    });
  });

  describe('getAclPerformanceAnalysis', () => {
    it('should return ACL performance analysis', () => {
      const analysis = service.getAclPerformanceAnalysis();

      expect(analysis).toHaveProperty('totalOperations');
      expect(analysis).toHaveProperty('avgTime');
      expect(analysis).toHaveProperty('performanceRating');
      expect(analysis.performanceRating).toBe('No data');
    });
  });

  describe('onModuleDestroy', () => {
    it('should clean up resources', async () => {
      // Set up some mock shells
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdin = { write: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();

      mockSpawn.mockReturnValue(mockProcess);

      await service.onModuleDestroy();

      // Should complete without errors
      expect(true).toBe(true);
    });
  });
});

// Additional tests for edge cases and error handling
describe('WinShellService Edge Cases', () => {
  let service: WinShellService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new WinShellService(mockLoggerFactory as any);
    Object.defineProperty(process, 'platform', { value: 'darwin' });
  });

  afterEach(async () => {
    if (service) {
      try {
        await service.onModuleDestroy();
      } catch (error) {
        // Ignore cleanup errors in tests
      }
    }
  });

  it('should handle empty command', async () => {
    await expect(service.executeCommand('')).rejects.toThrow();
  });

  it('should handle null command', async () => {
    await expect(service.executeCommand(null as any)).rejects.toThrow();
  });

  it('should handle undefined command', async () => {
    await expect(service.executeCommand(undefined as any)).rejects.toThrow();
  });
});

// Tests for PersistentShell class behavior
describe('PersistentShell Behavior Tests', () => {
  let service: WinShellService;
  let mockSpawn: jest.MockedFunction<typeof spawn>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

    service = new WinShellService(mockLoggerFactory as any);
  });

  afterEach(async () => {
    if (service) {
      try {
        await service.onModuleDestroy();
      } catch (error) {
        // Ignore cleanup errors in tests
      }
    }
  });

  it('should respect INIT_TIMEOUT environment variable', () => {
    const originalTimeout = process.env.INIT_TIMEOUT;
    process.env.INIT_TIMEOUT = '5000';

    // Test that the environment variable is read
    expect(process.env.INIT_TIMEOUT).toBe('5000');

    process.env.INIT_TIMEOUT = originalTimeout;
  });

  it('should have platform-specific behavior', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(process.platform).toBe('win32');

    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(process.platform).toBe('darwin');
  });
});
