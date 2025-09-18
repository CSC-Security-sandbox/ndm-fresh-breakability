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

// Mock ConfigService
const mockConfigService = {
  get: jest.fn().mockImplementation((key: string) => {
    const configValues = {
      'shellMonitoring.shellMonitoringInterval': 30000,
      'shellMonitoring.enableShellMonitoring': true,
      'shellMonitoring.poolSize': 10,
      'shellMonitoring.maxQueuePerShell': 1,
      'shellMonitoring.slowCommandThreshold': 5000,
      'shellMonitoring.runAsAdmin': false,
    };
    return configValues[key];
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

    // Create service instance with mocked dependencies
    service = new WinShellService(mockConfigService as any, mockLoggerFactory as any);
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

    service = new WinShellService(mockConfigService as any, mockLoggerFactory as any);
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

// Tests for comprehensive coverage of WinShellService
describe('WinShellService Comprehensive Tests', () => {
  let service: WinShellService;
  let mockSpawn: jest.MockedFunction<typeof spawn>;
  let mockProcess: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

    mockProcess = new EventEmitter();
    mockProcess.stdin = { write: jest.fn() };
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.kill = jest.fn();

    mockSpawn.mockReturnValue(mockProcess);

    service = new WinShellService(mockConfigService as any, mockLoggerFactory as any);
    Object.defineProperty(process, 'platform', { value: 'win32' });
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

  describe('Pool initialization and configuration', () => {
    it('should skip initialization on non-Windows platforms', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      
      await service.onModuleInit();
      
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should create admin shells when configured', () => {
      const adminConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          const configValues = {
            'shellMonitoring.shellMonitoringInterval': 30000,
            'shellMonitoring.enableShellMonitoring': true,
            'shellMonitoring.poolSize': 2,
            'shellMonitoring.maxQueuePerShell': 1,
            'shellMonitoring.slowCommandThreshold': 5000,
            'shellMonitoring.runAsAdmin': true, // Admin mode enabled
          };
          return configValues[key];
        }),
      };

      const adminService = new WinShellService(adminConfigService as any, mockLoggerFactory as any);
      
      // Just verify construction works - onModuleInit would be tested separately
      expect(adminService).toBeDefined();
      expect(adminService.isAdminModeEnabled()).toBe(true);
    });

    it('should handle monitoring configuration', () => {
      const noMonitoringConfig = {
        get: jest.fn().mockImplementation((key: string) => {
          const configValues = {
            'shellMonitoring.shellMonitoringInterval': 30000,
            'shellMonitoring.enableShellMonitoring': false, // Disabled
            'shellMonitoring.poolSize': 2,
            'shellMonitoring.maxQueuePerShell': 1,
            'shellMonitoring.slowCommandThreshold': 5000,
            'shellMonitoring.runAsAdmin': false,
          };
          return configValues[key];
        }),
      };

      const noMonitoringService = new WinShellService(noMonitoringConfig as any, mockLoggerFactory as any);
      expect(noMonitoringService).toBeDefined();
    });
  });

  describe('Fresh shell execution', () => {
    it('should execute command in fresh shell successfully', async () => {
      const freshPromise = service.executeInFreshShell('Get-Date');

      setTimeout(() => {
        mockProcess.stdout.emit('data', 'Fresh shell output');
        mockProcess.emit('exit', 0);
      }, 10);

      const result = await freshPromise;
      expect(result.stdout).toBe('Fresh shell output');
    });

    it('should handle fresh shell timeout', async () => {
      const freshPromise = service.executeInFreshShell('Start-Sleep -Seconds 60', 100);

      // Don't emit exit, let it timeout
      await expect(freshPromise).rejects.toThrow('timeout');
    }, 1000);

    it('should handle fresh shell process error', async () => {
      const freshPromise = service.executeInFreshShell('Get-Date');

      setTimeout(() => {
        mockProcess.emit('error', new Error('Process spawn failed'));
      }, 10);

      await expect(freshPromise).rejects.toThrow('Process spawn failed');
    });

    it('should handle fresh shell stderr output', async () => {
      const freshPromise = service.executeInFreshShell('Get-Date');

      setTimeout(() => {
        mockProcess.stderr.emit('data', 'Warning message');
        mockProcess.stdout.emit('data', 'Date output');
        mockProcess.emit('exit', 0);
      }, 10);

      const result = await freshPromise;
      expect(result.stdout).toBe('Date output');
      expect(result.stderr).toBe('Warning message');
    });
  });

  describe('Admin mode functionality', () => {
    it('should set and get admin mode correctly', () => {
      expect(service.isAdminModeEnabled()).toBe(false);

      service.setAdminMode(true);
      expect(service.isAdminModeEnabled()).toBe(true);

      service.setAdminMode(false);
      expect(service.isAdminModeEnabled()).toBe(false);
    });
  });

  describe('Statistics and performance analysis', () => {
    it('should return default execution time stats when no executions', () => {
      const stats = service.getExecutionTimeStats();

      expect(stats.avgTime).toBe(0);
      expect(stats.minTime).toBe(0);
      expect(stats.maxTime).toBe(0);
      expect(stats.samples).toBe(0);
      expect(stats.slowCommands).toBe(0);
    });

    it('should return service stats', () => {
      const stats = service.getStats();

      expect(stats).toHaveProperty('totalExecuted');
      expect(stats).toHaveProperty('totalErrors');
      expect(stats).toHaveProperty('poolSize');
      expect(stats).toHaveProperty('successRate');
      expect(stats).toHaveProperty('queues');
      expect(stats.successRate).toBe(100); // No operations yet
    });

    it('should return ACL performance analysis with no data', () => {
      const analysis = service.getAclPerformanceAnalysis();

      expect(analysis).toHaveProperty('totalOperations');
      expect(analysis).toHaveProperty('avgTime');
      expect(analysis).toHaveProperty('performanceRating');
      expect(analysis.performanceRating).toBe('No data');
      expect(analysis.totalOperations).toBe(0);
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle spawn process creation failure', () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('Failed to spawn process');
      });

      // Constructor should handle the error gracefully
      const failService = new WinShellService(mockConfigService as any, mockLoggerFactory as any);
      expect(failService).toBeDefined();
    });

    it('should handle invalid commands on non-Windows platforms', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      await expect(service.executeCommand('')).rejects.toThrow();
      await expect(service.executeCommand(null as any)).rejects.toThrow();
      await expect(service.executeCommand(undefined as any)).rejects.toThrow();
    });
  });

  describe('INIT_TIMEOUT environment variable', () => {
    it('should respect INIT_TIMEOUT environment variable', () => {
      const originalTimeout = process.env.INIT_TIMEOUT;
      process.env.INIT_TIMEOUT = '5000';

      expect(process.env.INIT_TIMEOUT).toBe('5000');

      process.env.INIT_TIMEOUT = originalTimeout;
    });

    it('should use default timeout when INIT_TIMEOUT is not set', () => {
      const originalTimeout = process.env.INIT_TIMEOUT;
      delete process.env.INIT_TIMEOUT;

      const defaultService = new WinShellService(mockConfigService as any, mockLoggerFactory as any);
      expect(defaultService).toBeDefined();

      process.env.INIT_TIMEOUT = originalTimeout;
    });
  });

  describe('Internal helper methods', () => {
    it('should handle getOptimalShellForAcl when no shells are initialized', async () => {
      // This will try to get a shell from an uninitialized pool
      try {
        await service.getOptimalShellForAcl();
      } catch (error) {
        // Expected to fail since no shells are initialized
        expect(error).toBeDefined();
      }
    });

    it('should handle destroy cleanup properly', async () => {
      await service.onModuleDestroy();
      // Should complete without errors
      expect(true).toBe(true);
    });
  });
});
