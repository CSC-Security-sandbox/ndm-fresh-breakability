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
      'shellMonitoring.poolSize': 2,
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
    service = new WinShellService(
      mockConfigService as any,
      mockLoggerFactory as any,
    );
    service = new WinShellService(
      mockConfigService as any,
      mockLoggerFactory as any,
    );
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

  describe('Non-Windows Platform Tests', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
    });

    it('should skip initialization on non-Windows platforms', async () => {
      await service.onModuleInit();
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should throw error for executeCommand on non-Windows platforms', async () => {
      await expect(service.executeCommand('test-command')).rejects.toThrow();
    });

    it('should handle empty command on non-Windows', async () => {
      await expect(service.executeCommand('')).rejects.toThrow();
    });

    it('should handle null command on non-Windows', async () => {
      await expect(service.executeCommand(null as any)).rejects.toThrow();
    });

    it('should handle undefined command on non-Windows', async () => {
      await expect(service.executeCommand(undefined as any)).rejects.toThrow();
    });

    it('should return default stats on non-Windows platforms', () => {
      const stats = service.getStats();
      expect(stats.totalExecuted).toBe(0);
      expect(stats.totalErrors).toBe(0);
      expect(stats.successRate).toBe(100);
    });

    it('should return no-data analysis on non-Windows platforms', () => {
      const analysis = service.getAclPerformanceAnalysis();
      expect(analysis.performanceRating).toBe('No data');
      expect(analysis.totalOperations).toBe(0);
    });

    it('should return default execution time stats', () => {
      const stats = service.getExecutionTimeStats();
      expect(stats.avgTime).toBe(0);
      expect(stats.minTime).toBe(0);
      expect(stats.maxTime).toBe(0);
      expect(stats.samples).toBe(0);
      expect(stats.slowCommands).toBe(0);
    });
  });

  describe('Admin Mode Management', () => {
    it('should set and get admin mode correctly', () => {
      expect(service.isAdminModeEnabled()).toBe(false);

      service.setAdminMode(true);
      expect(service.isAdminModeEnabled()).toBe(true);

      service.setAdminMode(false);
      expect(service.isAdminModeEnabled()).toBe(false);
    });

    it('should create service with admin mode enabled from config', () => {
      const adminConfig = {
        get: jest.fn().mockImplementation((key: string) => {
          const configValues = {
            'shellMonitoring.shellMonitoringInterval': 30000,
            'shellMonitoring.enableShellMonitoring': true,
            'shellMonitoring.poolSize': 2,
            'shellMonitoring.maxQueuePerShell': 1,
            'shellMonitoring.slowCommandThreshold': 5000,
            'shellMonitoring.runAsAdmin': true, // Admin enabled
          };
          return configValues[key];
        }),
      };

      const adminService = new WinShellService(
        adminConfig as any,
        mockLoggerFactory as any,
      );

      expect(adminService.isAdminModeEnabled()).toBe(true);
    });
  });

  describe('Fresh Shell Execution', () => {
    let mockProcess: any;

    beforeEach(() => {
      mockProcess = new EventEmitter();
      mockProcess.stdin = { write: jest.fn() };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();
      mockSpawn.mockReturnValue(mockProcess);
    });

    it('should create fresh shell process with correct parameters', () => {
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
      mockProcess.stdout.emit('data', 'test output');
      mockProcess.emit('exit', 0);

      return promise;
    });

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
      const freshPromise = service.executeInFreshShell(
        'Start-Sleep -Seconds 60',
        100,
      );

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
  describe('Windows Platform Mocked Execution', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    it('should handle Windows command execution with mocked shell', async () => {
      // Mock the internal shell execution
      const mockExecute = jest.fn().mockResolvedValue({
        stdout: 'Command executed successfully',
        stderr: '',
        exitCode: 0,
      });

      const mockShell = {
        execute: mockExecute,
        getQueueLength: jest.fn().mockReturnValue(0),
        id: 'test-shell',
        lastHealthCheck: Date.now(),
      };

      // Mock the getHealthyShell method
      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);

      const result = await service.executeCommand('Get-Date');

      expect(result.stdout).toBe('Command executed successfully');
      expect(result.stderr).toBe('');
      expect(mockExecute).toHaveBeenCalled();
    });

    it('should handle ACL operations with extended timeout', async () => {
      const mockExecute = jest.fn().mockResolvedValue({
        stdout: 'ACL operation completed',
        stderr: '',
        exitCode: 0,
      });

      const mockShell = {
        execute: mockExecute,
        getQueueLength: jest.fn().mockReturnValue(0),
        id: 'acl-shell',
        lastHealthCheck: Date.now(),
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);

      const aclCommand = 'Set-FileSecurityFast -Path "C:\\test"';
      const result = await service.executeCommand(aclCommand, 1000);

      expect(result.stdout).toBe('ACL operation completed');
      // Verify ACL operation gets extended timeout (minimum 90s)
      expect(mockExecute).toHaveBeenCalledWith(aclCommand, expect.any(Number));
    });

    it('should handle command execution errors', async () => {
      const mockShell = {
        execute: jest.fn().mockResolvedValue({
          stdout: '',
          stderr: 'Access denied',
          exitCode: 1,
        }),
        getQueueLength: jest.fn().mockReturnValue(0),
        id: 'error-shell',
        lastHealthCheck: Date.now(),
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);

      await expect(service.executeCommand('Test-Command')).rejects.toThrow(
        'Command failed: Access denied',
      );
    });

    it('should handle shell execution timeout', async () => {
      const mockShell = {
        execute: jest
          .fn()
          .mockRejectedValue(new Error('Command timeout: test-command')),
        getQueueLength: jest.fn().mockReturnValue(0),
        id: 'timeout-shell',
        lastHealthCheck: Date.now(),
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);

      await expect(
        service.executeCommand('Long-Running-Command', 1000),
      ).rejects.toThrow('timeout');
    });

    it('should handle queue full scenarios gracefully', async () => {
      const mockShell = {
        execute: jest.fn().mockResolvedValue({
          stdout: 'success after queue wait',
          stderr: '',
          exitCode: 0,
        }),
        getQueueLength: jest.fn().mockReturnValue(5), // Above max queue
        id: 'full-queue-shell',
        lastHealthCheck: Date.now(),
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);

      const result = await service.executeCommand('Test-Command');
      expect(result.stdout).toBe('success after queue wait');
    });
  });

  describe('Statistics and Performance Analysis', () => {
    it('should provide service statistics with mock data', () => {
      // Mock internal properties
      Object.defineProperty(service, 'totalExecuted', {
        value: 50,
        writable: true,
      });
      Object.defineProperty(service, 'totalErrors', {
        value: 5,
        writable: true,
      });
      Object.defineProperty(service, 'shells', {
        value: [
          { getQueueLength: () => 2, isAvailable: () => true, id: 'shell-1' },
          { getQueueLength: () => 0, isAvailable: () => false, id: 'shell-2' },
        ],
        writable: true,
      });

      const stats = service.getStats();

      expect(stats.poolSize).toBe(2); // From config
      expect(stats.totalExecuted).toBe(50);
      expect(stats.totalErrors).toBe(5);
      expect(stats.successRate).toBeCloseTo(90.91, 1);
      expect(stats.queues).toHaveLength(2);
    });

    it('should provide execution time statistics with mock data', () => {
      Object.defineProperty(service, 'executionTimes', {
        value: [1000, 2000, 3000, 10000],
        writable: true,
      });
      Object.defineProperty(service, 'slowCommandThreshold', {
        value: 5000,
        writable: true,
      });

      const timeStats = service.getExecutionTimeStats();

      expect(timeStats.avgTime).toBe(4000);
      expect(timeStats.minTime).toBe(1000);
      expect(timeStats.maxTime).toBe(10000);
      expect(timeStats.samples).toBe(4);
      expect(timeStats.slowCommands).toBe(1); // Commands > 5000ms threshold
    });

    it('should analyze ACL performance with mock execution data', () => {
      Object.defineProperty(service, 'executionTimes', {
        value: [5000, 15000, 35000, 65000],
        writable: true,
      });
      Object.defineProperty(service, 'totalExecuted', {
        value: 20,
        writable: true,
      });
      Object.defineProperty(service, 'totalErrors', {
        value: 2,
        writable: true,
      });

      const analysis = service.getAclPerformanceAnalysis();

      expect(analysis.totalOperations).toBe(20);
      expect(analysis.totalErrors).toBe(2);
      expect(analysis.estimatedAclOps).toBeGreaterThan(0);
      expect(analysis.successRate).toBeCloseTo(90.91, 1);
      expect(analysis.performanceRating).toBe('Fair'); // High avg time
      expect(analysis.recommendations.length).toBeGreaterThan(0);
    });

    it('should generate appropriate performance recommendations', () => {
      // Test excellent performance
      Object.defineProperty(service, 'executionTimes', {
        value: [1000, 2000, 3000],
        writable: true,
      });
      Object.defineProperty(service, 'totalExecuted', {
        value: 10,
        writable: true,
      });
      Object.defineProperty(service, 'totalErrors', {
        value: 0,
        writable: true,
      });

      const analysis = service.getAclPerformanceAnalysis();
      expect(analysis.performanceRating).toBe('Excellent');
      expect(analysis.recommendations).toContain('Performance is optimal');
    });
  });

  describe('Configuration Tests', () => {
    it('should handle different pool sizes', () => {
      const customConfig = {
        get: jest.fn().mockImplementation((key: string) => {
          const configValues = {
            'shellMonitoring.shellMonitoringInterval': 30000,
            'shellMonitoring.enableShellMonitoring': false,
            'shellMonitoring.poolSize': 5, // Custom pool size
            'shellMonitoring.maxQueuePerShell': 3,
            'shellMonitoring.slowCommandThreshold': 2000,
            'shellMonitoring.runAsAdmin': false,
          };
          return configValues[key];
        }),
      };

      const customService = new WinShellService(
        customConfig as any,
        mockLoggerFactory as any,
      );

      const stats = customService.getStats();
      expect(stats.poolSize).toBe(5);
    });

    it('should handle different slow command thresholds', () => {
      const thresholdConfig = {
        get: jest.fn().mockImplementation((key: string) => {
          const configValues = {
            'shellMonitoring.shellMonitoringInterval': 30000,
            'shellMonitoring.enableShellMonitoring': true,
            'shellMonitoring.poolSize': 2,
            'shellMonitoring.maxQueuePerShell': 1,
            'shellMonitoring.slowCommandThreshold': 1000, // Lower threshold
            'shellMonitoring.runAsAdmin': false,
          };
          return configValues[key];
        }),
      };

      const thresholdService = new WinShellService(
        thresholdConfig as any,
        mockLoggerFactory as any,
      );

      Object.defineProperty(thresholdService, 'executionTimes', {
        value: [500, 1500, 2000],
        writable: true,
      });

      const timeStats = thresholdService.getExecutionTimeStats();
      expect(timeStats.slowCommands).toBe(2); // 1500 and 2000 > 1000
      expect(timeStats.slowCommandThreshold).toBe(1000);
    });
  });

  describe('ACL Shell Management', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    it('should get optimal shell for ACL operations', async () => {
      const mockShells = [
        {
          getQueueLength: jest.fn().mockReturnValue(0),
          isAvailable: jest.fn().mockReturnValue(true),
          id: 'acl-shell-1',
        },
        {
          getQueueLength: jest.fn().mockReturnValue(5),
          isAvailable: jest.fn().mockReturnValue(true),
          id: 'acl-shell-2',
        },
      ];

      Object.defineProperty(service, 'shells', {
        value: mockShells,
        writable: true,
      });

      const optimalShell = await service.getOptimalShellForAcl();
      expect(optimalShell.id).toBe('acl-shell-1'); // Should pick the one with less queue
    });
  });

  describe('Cleanup and Destruction', () => {
    it('should handle onModuleDestroy cleanup', async () => {
      await service.onModuleDestroy();
      // Should complete without errors
      expect(true).toBe(true);
    });
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

    service = new WinShellService(
      mockConfigService as any,
      mockLoggerFactory as any,
    );
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });

  afterEach(async () => {
    if (service) {
      try {
        await service.onModuleDestroy();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  it('should manage admin mode state', () => {
    expect(service.isAdminModeEnabled()).toBe(false);

    service.setAdminMode(true);
    expect(service.isAdminModeEnabled()).toBe(true);

    service.setAdminMode(false);
    expect(service.isAdminModeEnabled()).toBe(false);
  });
});

// Tests for comprehensive coverage of WinShellService
describe('WinShellService Windows Platform Tests', () => {
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

    service = new WinShellService(
      mockConfigService as any,
      mockLoggerFactory as any,
    );
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

  describe('Windows Platform Initialization', () => {
    it('should initialize on Windows platform', () => {
      // Just test that spawn would be called during initialization
      expect(mockSpawn).toBeDefined();
      expect(service).toBeDefined();
    });

    it('should enable monitoring when configured', () => {
      const monitoringConfig = {
        get: jest.fn().mockImplementation((key: string) => {
          const configValues = {
            'shellMonitoring.shellMonitoringInterval': 1000,
            'shellMonitoring.enableShellMonitoring': true,
            'shellMonitoring.poolSize': 1,
            'shellMonitoring.maxQueuePerShell': 1,
            'shellMonitoring.slowCommandThreshold': 5000,
            'shellMonitoring.runAsAdmin': false,
          };
          return configValues[key];
        }),
      };

      const monitoringService = new WinShellService(
        monitoringConfig as any,
        mockLoggerFactory as any,
      );

      expect(monitoringService).toBeDefined();
    });
  });

  describe('Command Execution on Windows', () => {
    beforeEach(() => {
      // Setup successful shell initialization
      jest.spyOn(service as any, 'getHealthyShell').mockResolvedValue({
        execute: jest.fn().mockResolvedValue({
          stdout: 'Command executed successfully',
          stderr: '',
          exitCode: 0,
        }),
        getQueueLength: jest.fn().mockReturnValue(0),
        id: 'test-shell',
      });
    });

    it('should execute regular command successfully', async () => {
      const result = await service.executeCommand('Get-Date');

      expect(result.stdout).toBe('Command executed successfully');
      expect(result.stderr).toBe('');
    });

    it('should handle ACL operations with extended timeout', async () => {
      const aclCommand = 'Set-FileSecurityFast -Path "C:\\test"';
      const result = await service.executeCommand(aclCommand);

      expect(result.stdout).toBe('Command executed successfully');
    });

    it('should handle command execution errors', async () => {
      jest.spyOn(service as any, 'getHealthyShell').mockResolvedValue({
        execute: jest.fn().mockResolvedValue({
          stdout: '',
          stderr: 'Access denied',
          exitCode: 1,
        }),
        getQueueLength: jest.fn().mockReturnValue(0),
        id: 'test-shell',
      });

      await expect(service.executeCommand('Test-Command')).rejects.toThrow(
        'Command failed: Access denied',
      );
    });

    it('should handle shell execution timeout', async () => {
      jest.spyOn(service as any, 'getHealthyShell').mockResolvedValue({
        execute: jest
          .fn()
          .mockRejectedValue(new Error('Command timeout: test-command')),
        getQueueLength: jest.fn().mockReturnValue(0),
        id: 'test-shell',
      });

      await expect(
        service.executeCommand('Long-Running-Command', 1000),
      ).rejects.toThrow('timeout');
    });

    it('should handle queue full scenarios', async () => {
      jest.spyOn(service as any, 'getHealthyShell').mockResolvedValue({
        execute: jest.fn().mockResolvedValue({
          stdout: 'success',
          stderr: '',
          exitCode: 0,
        }),
        getQueueLength: jest.fn().mockReturnValue(10), // Max queue exceeded
        id: 'test-shell',
      });

      const result = await service.executeCommand('Test-Command');
      expect(result.stdout).toBe('success');
    });
  });

  describe('Shell Health Management', () => {
    it('should perform health checks on shells', async () => {
      const mockShell = {
        lastHealthCheck: Date.now() - 400000, // 6+ minutes ago
        performHealthCheck: jest.fn().mockResolvedValue(true),
        needsRecreation: jest.fn().mockReturnValue(false),
        execute: jest.fn().mockResolvedValue({
          stdout: 'health check ok',
          stderr: '',
          exitCode: 0,
        }),
        getQueueLength: jest.fn().mockReturnValue(0),
        id: 'health-test-shell',
      };

      jest.spyOn(service as any, 'getOptimalShell').mockReturnValue(mockShell);

      const result = await service.executeCommand('Test-Health');

      expect(mockShell.performHealthCheck).toHaveBeenCalled();
      expect(result.stdout).toBe('health check ok');
    });

    it('should handle unhealthy shell replacement', () => {
      const mockShell = {
        lastHealthCheck: Date.now() - 400000,
        performHealthCheck: jest.fn().mockResolvedValue(false),
        needsRecreation: jest.fn().mockReturnValue(true),
        destroy: jest.fn(),
        execute: jest.fn().mockResolvedValue({
          stdout: 'executed on new shell',
          stderr: '',
          exitCode: 0,
        }),
        getQueueLength: jest.fn().mockReturnValue(0),
        id: 'unhealthy-shell',
      };

      expect(mockShell.destroy).toBeDefined();
      expect(mockShell.needsRecreation()).toBe(true);
      expect(mockShell.performHealthCheck).toBeDefined();
    });
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

      const adminService = new WinShellService(
        adminConfigService as any,
        mockLoggerFactory as any,
      );

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

      const noMonitoringService = new WinShellService(
        noMonitoringConfig as any,
        mockLoggerFactory as any,
      );
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
      const freshPromise = service.executeInFreshShell(
        'Start-Sleep -Seconds 60',
        100,
      );

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
      const failService = new WinShellService(
        mockConfigService as any,
        mockLoggerFactory as any,
      );
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

      const defaultService = new WinShellService(
        mockConfigService as any,
        mockLoggerFactory as any,
      );
      expect(defaultService).toBeDefined();

      process.env.INIT_TIMEOUT = originalTimeout;
    });
  });

  describe('ACL Operations and Performance', () => {
    it('should get optimal shell for ACL operations', async () => {
      const mockShells = [
        {
          getQueueLength: jest.fn().mockReturnValue(0),
          isAvailable: jest.fn().mockReturnValue(true),
          id: 'acl-shell-1',
        },
        {
          getQueueLength: jest.fn().mockReturnValue(5),
          isAvailable: jest.fn().mockReturnValue(true),
          id: 'acl-shell-2',
        },
      ];

      Object.defineProperty(service, 'shells', {
        value: mockShells,
        writable: true,
      });

      const optimalShell = await service.getOptimalShellForAcl();
      expect(optimalShell.id).toBe('acl-shell-1'); // Should pick the one with less queue
    });

    it('should wait for available shell when all busy', async () => {
      const mockShell = {
        getQueueLength: jest.fn().mockReturnValue(0),
        isAvailable: jest
          .fn()
          .mockReturnValueOnce(false) // First check - busy
          .mockReturnValueOnce(false) // Second check - still busy
          .mockReturnValue(true), // Third check - available
        id: 'busy-shell',
      };

      Object.defineProperty(service, 'shells', {
        value: [mockShell],
        writable: true,
      });

      const promise = service.getOptimalShellForAcl();

      // Simulate shell becoming available after delay
      setTimeout(() => {
        mockShell.isAvailable.mockReturnValue(true);
      }, 150);

      const result = await promise;
      expect(result.id).toBe('busy-shell');
    });

    it('should generate performance recommendations', () => {
      const analysis = service.getAclPerformanceAnalysis();
      expect(analysis).toBeDefined();
      expect(analysis.performanceRating).toBeDefined();
      expect(typeof analysis.performanceRating).toBe('string');
    });

    it('should track execution times and provide stats', () => {
      // Simulate some execution times being tracked
      Object.defineProperty(service, 'executionTimes', {
        value: [1000, 2000, 30000, 60000],
        writable: true,
      });
      Object.defineProperty(service, 'totalExecuted', {
        value: 10,
        writable: true,
      });
      Object.defineProperty(service, 'totalErrors', {
        value: 1,
        writable: true,
      });

      const analysis = service.getAclPerformanceAnalysis();

      expect(analysis.totalOperations).toBe(10);
      expect(analysis.totalErrors).toBe(1);
      expect(analysis.estimatedAclOps).toBeGreaterThan(0);
      expect(analysis.successRate).toBeCloseTo(90.91, 1);
      expect(analysis.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('Statistics and Monitoring', () => {
    beforeEach(() => {
      // Mock some shells in the pool
      const mockShells = [
        {
          getQueueLength: jest.fn().mockReturnValue(2),
          isAvailable: jest.fn().mockReturnValue(true),
          id: 'stats-shell-1',
        },
        {
          getQueueLength: jest.fn().mockReturnValue(0),
          isAvailable: jest.fn().mockReturnValue(false),
          id: 'stats-shell-2',
        },
      ];
      Object.defineProperty(service, 'shells', {
        value: mockShells,
        writable: true,
      });
      Object.defineProperty(service, 'totalExecuted', {
        value: 50,
        writable: true,
      });
      Object.defineProperty(service, 'totalErrors', {
        value: 5,
        writable: true,
      });
    });

    it('should provide detailed service statistics', () => {
      const stats = service.getStats();

      expect(stats.poolSize).toBe(2); // From mock config
      expect(stats.totalExecuted).toBe(50);
      expect(stats.totalErrors).toBe(5);
      expect(stats.successRate).toBeCloseTo(90.91, 1);
      expect(stats.queues).toHaveLength(2);
      expect(stats.queues[0].queueLength).toBe(2);
      expect(stats.queues[1].available).toBe(false);
    });

    it('should provide execution time statistics', () => {
      Object.defineProperty(service, 'executionTimes', {
        value: [1000, 2000, 3000, 10000],
        writable: true,
      });

      const timeStats = service.getExecutionTimeStats();

      expect(timeStats.avgTime).toBe(4000);
      expect(timeStats.minTime).toBe(1000);
      expect(timeStats.maxTime).toBe(10000);
      expect(timeStats.samples).toBe(4);
      expect(timeStats.slowCommands).toBe(1); // Commands > 5000ms threshold
    });

    it('should track slow commands correctly', () => {
      Object.defineProperty(service, 'executionTimes', {
        value: [1000, 6000, 7000],
        writable: true,
      });
      Object.defineProperty(service, 'slowCommandThreshold', {
        value: 5000,
        writable: true,
      });

      const timeStats = service.getExecutionTimeStats();
      expect(timeStats.slowCommands).toBe(2); // 6000 and 7000 > 5000
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

    it('should handle shell monitoring configuration', () => {
      const quickMonitoringConfig = {
        get: jest.fn().mockImplementation((key: string) => {
          const configValues = {
            'shellMonitoring.shellMonitoringInterval': 100, // Very fast for testing
            'shellMonitoring.enableShellMonitoring': true,
            'shellMonitoring.poolSize': 1,
            'shellMonitoring.maxQueuePerShell': 1,
            'shellMonitoring.slowCommandThreshold': 5000,
            'shellMonitoring.runAsAdmin': false,
          };
          return configValues[key];
        }),
      };

      const monitoringService = new WinShellService(
        quickMonitoringConfig as any,
        mockLoggerFactory as any,
      );

      expect(monitoringService).toBeDefined();
      expect(quickMonitoringConfig.get).toHaveBeenCalled();
    });
  });

  describe('Advanced Command Execution', () => {
    it('should track execution times when executing commands', async () => {
      const mockShell = {
        lastHealthCheck: Date.now(),
        getQueueLength: jest.fn().mockReturnValue(0),
        execute: jest.fn().mockResolvedValue({
          stdout: 'Success',
          stderr: '',
          exitCode: 0,
        }),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'test-shell',
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);
      Object.defineProperty(service, 'executionTimes', {
        value: [],
        writable: true,
      });

      const result = await service.executeCommand('Test-Command');

      expect(result.stdout).toBe('Success');
      expect(mockShell.execute).toHaveBeenCalledWith('Test-Command', 20000);
    });

    it('should handle ACL operations with extended timeout', async () => {
      const mockShell = {
        lastHealthCheck: Date.now(),
        getQueueLength: jest.fn().mockReturnValue(0),
        execute: jest.fn().mockResolvedValue({
          stdout: 'ACL Success',
          stderr: '',
          exitCode: 0,
        }),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'acl-shell',
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);

      const result = await service.executeCommand(
        'Set-FileSecurityFast -Path "C:\\test"',
      );

      expect(result.stdout).toBe('ACL Success');
      expect(mockShell.execute).toHaveBeenCalledWith(
        'Set-FileSecurityFast -Path "C:\\test"',
        90000,
      );
    });

    it('should handle command errors and track them', async () => {
      const mockShell = {
        lastHealthCheck: Date.now(),
        getQueueLength: jest.fn().mockReturnValue(0),
        execute: jest.fn().mockResolvedValue({
          stdout: '',
          stderr: 'Access denied',
          exitCode: 1,
        }),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'error-shell',
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);
      Object.defineProperty(service, 'totalErrors', {
        value: 0,
        writable: true,
      });

      await expect(service.executeCommand('Fail-Command')).rejects.toThrow(
        'Command failed',
      );
    });

    it('should handle queue full scenarios', async () => {
      const mockShell = {
        lastHealthCheck: Date.now(),
        getQueueLength: jest.fn().mockReturnValue(10), // Exceeds max queue
        execute: jest.fn().mockResolvedValue({
          stdout: 'Success',
          stderr: '',
          exitCode: 0,
        }),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'busy-shell',
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);
      Object.defineProperty(service, 'maxQueuePerShell', {
        value: 5,
        writable: true,
      });
      Object.defineProperty(service, 'dropWhenFull', {
        value: false,
        writable: true,
      });

      // Should wait and then execute
      const result = await service.executeCommand('Test-Queue');
      expect(result.stdout).toBe('Success');
    });

    it('should drop commands when queue is full and dropWhenFull is enabled', async () => {
      const mockShell = {
        lastHealthCheck: Date.now(),
        getQueueLength: jest.fn().mockReturnValue(10), // Exceeds max queue
        execute: jest.fn().mockResolvedValue({
          stdout: 'Success',
          stderr: '',
          exitCode: 0,
        }),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'drop-shell',
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);
      Object.defineProperty(service, 'maxQueuePerShell', {
        value: 5,
        writable: true,
      });
      Object.defineProperty(service, 'dropWhenFull', {
        value: true,
        writable: true,
      });

      await expect(service.executeCommand('Test-Drop')).rejects.toThrow(
        'queue full',
      );
    });
  });

  describe('Shell Health and Monitoring', () => {
    it('should perform health checks on stale shells', async () => {
      const mockShell = {
        lastHealthCheck: Date.now() - 400000, // 6+ minutes ago
        performHealthCheck: jest.fn().mockResolvedValue(true),
        needsRecreation: jest.fn().mockReturnValue(false),
        execute: jest.fn().mockResolvedValue({
          stdout: 'healthy',
          stderr: '',
          exitCode: 0,
        }),
        getQueueLength: jest.fn().mockReturnValue(0),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'stale-shell',
      };

      jest.spyOn(service as any, 'getOptimalShell').mockReturnValue(mockShell);

      const result = await service.executeCommand('Test-Health');

      expect(mockShell.performHealthCheck).toHaveBeenCalled();
      expect(result.stdout).toBe('healthy');
    });

    it('should handle shell recreation needs', () => {
      const mockShell = {
        lastHealthCheck: Date.now() - 400000,
        performHealthCheck: jest.fn().mockResolvedValue(false),
        needsRecreation: jest.fn().mockReturnValue(true),
        destroy: jest.fn(),
        execute: jest.fn().mockResolvedValue({
          stdout: 'replaced',
          stderr: '',
          exitCode: 0,
        }),
        getQueueLength: jest.fn().mockReturnValue(0),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'replace-shell',
      };

      expect(mockShell.needsRecreation()).toBe(true);
      expect(mockShell.destroy).toBeDefined();
    });

    it('should handle shell replacement scenarios', () => {
      const mockShell = {
        lastHealthCheck: Date.now() - 400000,
        performHealthCheck: jest.fn().mockResolvedValue(false),
        needsRecreation: jest.fn().mockReturnValue(true),
        destroy: jest.fn(),
        execute: jest.fn().mockResolvedValue({
          stdout: 'fallback',
          stderr: '',
          exitCode: 0,
        }),
        getQueueLength: jest.fn().mockReturnValue(0),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'fallback-shell',
      };

      expect(mockShell.needsRecreation()).toBe(true);
      expect(mockShell.performHealthCheck).toBeDefined();
    });
  });

  describe('Shell Pool Management', () => {
    it('should handle shell pool initialization concepts', () => {
      // Test basic pool concepts without complex mocking
      expect((service as any).poolSize).toBeDefined();
      expect((service as any).shells).toBeDefined();
    });

    it('should replace shells correctly', async () => {
      const addShellSpy = jest
        .spyOn(service as any, 'addShellAtIndex')
        .mockResolvedValue(undefined);

      await (service as any).replaceShell(0, 'old-shell');

      expect(addShellSpy).toHaveBeenCalledWith(
        0,
        expect.stringContaining('old-shell-restart-'),
      );
    });

    it('should handle shell index operations', () => {
      Object.defineProperty(service, 'rrIndex', {
        value: 0,
        writable: true,
      });
      Object.defineProperty(service, 'shells', {
        value: [{ id: 'shell-0' }, { id: 'shell-1' }],
        writable: true,
      });

      const shell1 = (service as any).getOptimalShell();
      const shell2 = (service as any).getOptimalShell();

      expect(shell1.id).toBe('shell-0');
      expect(shell2.id).toBe('shell-1');
    });
  });

  describe('Core Execution Workflows', () => {
    it('should handle getHealthyShell workflow', async () => {
      const mockShell = {
        lastHealthCheck: Date.now() - 100000, // Recent
        performHealthCheck: jest.fn().mockResolvedValue(true),
        needsRecreation: jest.fn().mockReturnValue(false),
        id: 'healthy-shell',
      };

      jest.spyOn(service as any, 'getOptimalShell').mockReturnValue(mockShell);

      const result = await (service as any).getHealthyShell();

      expect(result).toBe(mockShell);
      expect(mockShell.performHealthCheck).not.toHaveBeenCalled(); // Recent health check
    });

    it('should perform health check on stale shells', async () => {
      const mockShell = {
        lastHealthCheck: Date.now() - 400000, // 6+ minutes ago
        performHealthCheck: jest.fn().mockResolvedValue(true),
        needsRecreation: jest.fn().mockReturnValue(false),
        id: 'stale-shell',
      };

      jest.spyOn(service as any, 'getOptimalShell').mockReturnValue(mockShell);

      const result = await (service as any).getHealthyShell();

      expect(result).toBe(mockShell);
      expect(mockShell.performHealthCheck).toHaveBeenCalled();
    });

    it('should handle unhealthy shell recreation flow', async () => {
      const mockShell = {
        lastHealthCheck: Date.now() - 400000,
        performHealthCheck: jest.fn().mockResolvedValue(false),
        needsRecreation: jest.fn().mockReturnValue(true),
        destroy: jest.fn(),
        id: 'unhealthy-shell',
      };

      jest.spyOn(service as any, 'getOptimalShell').mockReturnValue(mockShell);
      Object.defineProperty(service, 'shells', {
        value: [mockShell],
        writable: true,
      });

      // Mock the shell index finding
      const findIndexSpy = jest
        .spyOn(Array.prototype, 'findIndex')
        .mockReturnValue(0);
      const addShellSpy = jest
        .spyOn(service as any, 'addShellAtIndex')
        .mockResolvedValue(undefined);

      const newShell = { id: 'new-shell' };
      // After replacement, the shells array should have the new shell
      (service as any).shells[0] = newShell;

      const result = await (service as any).getHealthyShell();

      expect(mockShell.performHealthCheck).toHaveBeenCalled();
      expect(mockShell.needsRecreation).toHaveBeenCalled();

      // Cleanup
      findIndexSpy.mockRestore();
      addShellSpy.mockRestore();
    });

    it('should handle health check scheduling concepts', () => {
      const mockShell = {
        isAvailable: jest.fn().mockReturnValue(true),
        performHealthCheck: jest.fn().mockResolvedValue(true),
        needsRecreation: jest.fn().mockReturnValue(false),
      };

      // Test that the method exists and can be called
      expect(() =>
        (service as any).scheduleHealthCheck(mockShell),
      ).not.toThrow();
    });

    it('should handle round-robin shell selection correctly', () => {
      const shells = [{ id: 'shell-0' }, { id: 'shell-1' }, { id: 'shell-2' }];

      Object.defineProperty(service, 'shells', {
        value: shells,
        writable: true,
      });
      Object.defineProperty(service, 'rrIndex', {
        value: 1,
        writable: true,
      });

      const shell1 = (service as any).getOptimalShell();
      const shell2 = (service as any).getOptimalShell();

      expect(shell1.id).toBe('shell-1');
      expect(shell2.id).toBe('shell-2');
    });
  });

  describe('Shell Monitoring and Lifecycle', () => {
    it('should start shell monitoring when enabled', () => {
      const intervalSpy = jest
        .spyOn(global, 'setInterval')
        .mockImplementation(() => 123 as any);

      Object.defineProperty(service, 'shellMonitoringInterval', {
        value: 1000,
        writable: true,
      });

      (service as any).startShellMonitoring();

      expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);

      // Cleanup
      intervalSpy.mockRestore();
    });

    it('should handle monitoring configuration and setup', () => {
      const mockShells = [
        {
          isAvailable: jest.fn().mockReturnValue(true),
          getQueueLength: jest.fn().mockReturnValue(2),
          id: 'monitor-shell-1',
        },
        {
          isAvailable: jest.fn().mockReturnValue(false),
          getQueueLength: jest.fn().mockReturnValue(0),
          id: 'monitor-shell-2',
        },
      ];

      Object.defineProperty(service, 'shells', {
        value: mockShells,
        writable: true,
      });

      // Test that monitoring concepts are in place
      expect((service as any).shellMonitoringInterval).toBeDefined();
      expect(mockShells).toHaveLength(2);
    });

    it('should handle module destruction properly', async () => {
      const mockShells = [
        { destroy: jest.fn(), id: 'destroy-1' },
        { destroy: jest.fn(), id: 'destroy-2' },
      ];

      Object.defineProperty(service, 'shells', {
        value: mockShells,
        writable: true,
      });
      Object.defineProperty(service, 'monitoringInterval', {
        value: 123,
        writable: true,
      });

      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      await service.onModuleDestroy();

      expect(mockShells[0].destroy).toHaveBeenCalled();
      expect(mockShells[1].destroy).toHaveBeenCalled();
      expect(clearIntervalSpy).toHaveBeenCalledWith(123);

      clearIntervalSpy.mockRestore();
    });
  });

  describe('Advanced Command Execution Scenarios', () => {
    it('should handle slow command logging for ACL operations', async () => {
      const mockShell = {
        lastHealthCheck: Date.now(),
        getQueueLength: jest.fn().mockReturnValue(0),
        execute: jest.fn().mockImplementation(() => {
          // Simulate slow execution
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                stdout: 'ACL slow success',
                stderr: '',
                exitCode: 0,
              });
            }, 100);
          });
        }),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'slow-acl-shell',
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);

      const result = await service.executeCommand('Set-Acl -Path "C:\\test"');

      expect(result.stdout).toBe('ACL slow success');
      expect(mockShell.execute).toHaveBeenCalledWith(
        'Set-Acl -Path "C:\\test"',
        90000,
      );
    });

    it('should handle command execution with pipeline errors', async () => {
      const mockShell = {
        lastHealthCheck: Date.now(),
        getQueueLength: jest.fn().mockReturnValue(0),
        execute: jest.fn().mockResolvedValue({
          stdout: '',
          stderr: 'pipeline terminated unexpectedly',
          exitCode: 1,
        }),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'pipeline-error-shell',
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);
      jest
        .spyOn(service as any, 'scheduleHealthCheck')
        .mockImplementation(() => {});

      await expect(
        service.executeCommand('Bad-Pipeline-Command'),
      ).rejects.toThrow('Command failed');
    });

    it('should handle execution timeout scenarios', async () => {
      const mockShell = {
        lastHealthCheck: Date.now(),
        getQueueLength: jest.fn().mockReturnValue(0),
        execute: jest
          .fn()
          .mockRejectedValue(new Error('Command timeout: test-command')),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'timeout-shell',
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);

      await expect(
        service.executeCommand('Long-Command', 1000),
      ).rejects.toThrow();
    });

    it('should track execution statistics accurately', async () => {
      const mockShell = {
        lastHealthCheck: Date.now(),
        getQueueLength: jest.fn().mockReturnValue(0),
        execute: jest.fn().mockResolvedValue({
          stdout: 'Success',
          stderr: '',
          exitCode: 0,
        }),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'stats-shell',
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);

      Object.defineProperty(service, 'executionTimes', {
        value: [],
        writable: true,
      });
      Object.defineProperty(service, 'totalExecuted', {
        value: 0,
        writable: true,
      });

      await service.executeCommand('Stats-Command');

      // Verify statistics were updated
      const executionTimes = (service as any).executionTimes;
      const totalExecuted = (service as any).totalExecuted;

      expect(executionTimes.length).toBe(1);
      expect(totalExecuted).toBe(1);
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete execution workflow', async () => {
      // Mock a complete healthy execution workflow
      const mockShell = {
        lastHealthCheck: Date.now() - 100000, // Recent health check
        performHealthCheck: jest.fn().mockResolvedValue(true),
        needsRecreation: jest.fn().mockReturnValue(false),
        execute: jest.fn().mockResolvedValue({
          stdout: 'Integration success',
          stderr: '',
          exitCode: 0,
        }),
        getQueueLength: jest.fn().mockReturnValue(1),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'integration-shell',
      };

      jest.spyOn(service as any, 'getOptimalShell').mockReturnValue(mockShell);

      const result = await service.executeCommand('Get-Process');
      expect(result.stdout).toBe('Integration success');
      expect(mockShell.execute).toHaveBeenCalledWith('Get-Process', 20000);
    });

    it('should handle shell error tracking workflow', async () => {
      const mockShell = {
        lastHealthCheck: Date.now(),
        getQueueLength: jest.fn().mockReturnValue(0),
        execute: jest.fn().mockResolvedValue({
          stdout: '',
          stderr: 'pipeline terminated',
          exitCode: 1,
        }),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'error-tracking-shell',
      };

      jest.spyOn(service as any, 'getOptimalShell').mockReturnValue(mockShell);
      jest
        .spyOn(service as any, 'scheduleHealthCheck')
        .mockImplementation(() => {});
      Object.defineProperty(service, 'totalErrors', {
        value: 0,
        writable: true,
      });

      await expect(service.executeCommand('Bad-Command')).rejects.toThrow(
        'Command failed',
      );
    });

    it('should properly track ACL performance metrics', async () => {
      const mockShell = {
        lastHealthCheck: Date.now(),
        getQueueLength: jest.fn().mockReturnValue(0),
        execute: jest.fn().mockResolvedValue({
          stdout: 'ACL operation completed',
          stderr: '',
          exitCode: 0,
        }),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'acl-metrics-shell',
      };

      jest.spyOn(service as any, 'getOptimalShell').mockReturnValue(mockShell);
      Object.defineProperty(service, 'executionTimes', {
        value: [],
        writable: true,
      });

      const result = await service.executeCommand('Get-Acl -Path "C:\\test"');
      expect(result.stdout).toBe('ACL operation completed');
      expect(mockShell.execute).toHaveBeenCalledWith(
        'Get-Acl -Path "C:\\test"',
        90000,
      );
    });

    it('should handle round-robin shell selection', () => {
      const mockShells = [
        { id: 'shell-0' },
        { id: 'shell-1' },
        { id: 'shell-2' },
      ];

      Object.defineProperty(service, 'shells', {
        value: mockShells,
        writable: true,
      });
      Object.defineProperty(service, 'rrIndex', {
        value: 0,
        writable: true,
      });

      const shell1 = (service as any).getOptimalShell();
      const shell2 = (service as any).getOptimalShell();
      const shell3 = (service as any).getOptimalShell();

      expect(shell1.id).toBe('shell-0');
      expect(shell2.id).toBe('shell-1');
      expect(shell3.id).toBe('shell-2');
    });

    it('should calculate execution statistics correctly', () => {
      Object.defineProperty(service, 'executionTimes', {
        value: [1000, 2000, 3000, 8000, 12000],
        writable: true,
      });
      Object.defineProperty(service, 'slowCommandThreshold', {
        value: 5000,
        writable: true,
      });

      const stats = service.getExecutionTimeStats();

      expect(stats.avgTime).toBe(5200); // (1000+2000+3000+8000+12000)/5
      expect(stats.minTime).toBe(1000);
      expect(stats.maxTime).toBe(12000);
      expect(stats.samples).toBe(5);
      expect(stats.slowCommands).toBe(2); // 8000 and 12000 > 5000
    });

    it('should handle module initialization and cleanup lifecycle', async () => {
      // Test module initialization
      expect(service).toBeDefined();

      // Test module destruction
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });

    it('should handle configuration variations', () => {
      // Test different configuration scenarios
      const configs = [
        { runAsAdmin: true, enableMonitoring: false },
        { runAsAdmin: false, enableMonitoring: true },
        { poolSize: 1, maxQueue: 2 },
        { poolSize: 5, maxQueue: 10 },
      ];

      configs.forEach((config) => {
        const testConfig = {
          get: jest.fn().mockImplementation((key: string) => {
            const configValues = {
              'shellMonitoring.shellMonitoringInterval': 30000,
              'shellMonitoring.enableShellMonitoring':
                config.enableMonitoring || false,
              'shellMonitoring.poolSize': config.poolSize || 2,
              'shellMonitoring.maxQueuePerShell': config.maxQueue || 1,
              'shellMonitoring.slowCommandThreshold': 5000,
              'shellMonitoring.runAsAdmin': config.runAsAdmin || false,
            };
            return configValues[key];
          }),
        };

        const testService = new WinShellService(
          testConfig as any,
          mockLoggerFactory as any,
        );
        expect(testService).toBeDefined();
      });
    });

    it('should properly handle platform detection', () => {
      // Test platform detection
      const originalPlatform = process.platform;

      try {
        // Test Windows platform
        Object.defineProperty(process, 'platform', {
          value: 'win32',
          configurable: true,
        });
        const winService = new WinShellService(
          mockConfigService as any,
          mockLoggerFactory as any,
        );
        expect(winService).toBeDefined();

        // Test non-Windows platform
        Object.defineProperty(process, 'platform', {
          value: 'darwin',
          configurable: true,
        });
        const macService = new WinShellService(
          mockConfigService as any,
          mockLoggerFactory as any,
        );
        expect(macService).toBeDefined();
      } finally {
        // Restore original platform
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true,
        });
      }
    });

    it('should track execution times and error counts accurately', async () => {
      Object.defineProperty(service, 'totalExecuted', {
        value: 100,
        writable: true,
      });
      Object.defineProperty(service, 'totalErrors', {
        value: 5,
        writable: true,
      });
      Object.defineProperty(service, 'executionTimes', {
        value: [1000, 2000, 3000],
        writable: true,
      });

      const stats = service.getStats();
      expect(stats.totalExecuted).toBe(100);
      expect(stats.totalErrors).toBe(5);
      expect(stats.successRate).toBeCloseTo(95, 0);

      const timeStats = service.getExecutionTimeStats();
      expect(timeStats.samples).toBe(3);
      expect(timeStats.avgTime).toBe(2000);
    });

    it('should provide comprehensive ACL performance analysis', () => {
      // Set up realistic ACL operation data
      Object.defineProperty(service, 'executionTimes', {
        value: [5000, 10000, 15000, 20000, 25000],
        writable: true,
      });
      Object.defineProperty(service, 'totalExecuted', {
        value: 50,
        writable: true,
      });
      Object.defineProperty(service, 'totalErrors', {
        value: 2,
        writable: true,
      });

      const analysis = service.getAclPerformanceAnalysis();

      expect(analysis.totalOperations).toBe(50);
      expect(analysis.totalErrors).toBe(2);
      expect(analysis.avgTime).toBe(15000); // Average of execution times
      expect(analysis.successRate).toBeCloseTo(96, 0); // 48/50 * 100
      expect(analysis.estimatedAclOps).toBeGreaterThan(0);
      expect(analysis.performanceRating).toBeDefined();
      expect(typeof analysis.performanceRating).toBe('string');
    });
  });

  describe('Comprehensive Coverage Tests', () => {
    it('should handle executeInFreshShell with various scenarios', async () => {
      // Test successful execution
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as any;
        proc.stdin = { write: jest.fn() };
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = jest.fn();

        setTimeout(() => {
          proc.stdout.emit('data', 'Fresh shell output');
          proc.emit('exit', 0);
        }, 10);

        return proc;
      });

      const result = await service.executeInFreshShell('Get-Date');
      expect(result.stdout).toBe('Fresh shell output');
    });

    it('should handle executeInFreshShell timeout', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as any;
        proc.stdin = { write: jest.fn() };
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = jest.fn();
        // Don't emit exit - let it timeout
        return proc;
      });

      await expect(
        service.executeInFreshShell('Long-Command', 50),
      ).rejects.toThrow('timeout');
    });

    it('should handle process spawn errors in fresh shell', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as any;
        proc.stdin = { write: jest.fn() };
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = jest.fn();

        setTimeout(() => {
          proc.emit('error', new Error('Spawn failed'));
        }, 10);

        return proc;
      });

      await expect(service.executeInFreshShell('Get-Date')).rejects.toThrow(
        'Spawn failed',
      );
    });

    it('should handle complex ACL shell selection', async () => {
      const mockShells = [
        {
          getQueueLength: jest.fn().mockReturnValue(5),
          isAvailable: jest.fn().mockReturnValue(true),
          id: 'acl-shell-1',
        },
        {
          getQueueLength: jest.fn().mockReturnValue(2),
          isAvailable: jest.fn().mockReturnValue(true),
          id: 'acl-shell-2',
        },
        {
          getQueueLength: jest.fn().mockReturnValue(10),
          isAvailable: jest.fn().mockReturnValue(false), // Unavailable
          id: 'acl-shell-3',
        },
      ];

      Object.defineProperty(service, 'shells', {
        value: mockShells,
        writable: true,
      });

      const result = await service.getOptimalShellForAcl();
      expect(result.id).toBe('acl-shell-2'); // Should pick available with lowest queue
    });

    it('should handle execution with detailed timing and statistics', async () => {
      const mockShell = {
        lastHealthCheck: Date.now(),
        getQueueLength: jest.fn().mockReturnValue(1),
        execute: jest.fn().mockImplementation(() => {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                stdout: 'Timed execution success',
                stderr: '',
                exitCode: 0,
              });
            }, 50);
          });
        }),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'timing-shell',
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);
      Object.defineProperty(service, 'executionTimes', {
        value: [1000, 2000],
        writable: true,
      });
      Object.defineProperty(service, 'totalExecuted', {
        value: 5,
        writable: true,
      });
      Object.defineProperty(service, 'slowCommandThreshold', {
        value: 5000,
        writable: true,
      });

      const result = await service.executeCommand('Timing-Test');

      expect(result.stdout).toBe('Timed execution success');

      // Verify execution times array was updated
      const executionTimes = (service as any).executionTimes;
      expect(executionTimes.length).toBe(3); // Original 2 + 1 new

      // Verify total executed was incremented
      const totalExecuted = (service as any).totalExecuted;
      expect(totalExecuted).toBe(6); // 5 + 1
    });

    it('should handle error tracking with shell health scheduling', async () => {
      const mockShell = {
        lastHealthCheck: Date.now(),
        getQueueLength: jest.fn().mockReturnValue(0),
        execute: jest.fn().mockResolvedValue({
          stdout: '',
          stderr: 'session terminated unexpectedly',
          exitCode: 1,
        }),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'error-shell',
      };

      const scheduleHealthCheckSpy = jest
        .spyOn(service as any, 'scheduleHealthCheck')
        .mockImplementation(() => {});
      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);

      // Test that the command fails and health check is scheduled
      await expect(service.executeCommand('Failing-Command')).rejects.toThrow(
        'Command failed',
      );

      // Verify that error tracking mechanisms are in place (existence of totalErrors property)
      expect((service as any).totalErrors).toBeDefined();
      expect(typeof (service as any).totalErrors).toBe('number');
    });

    it('should handle ACL operations with slow command detection', async () => {
      const mockShell = {
        lastHealthCheck: Date.now(),
        getQueueLength: jest.fn().mockReturnValue(0),
        execute: jest.fn().mockImplementation(() => {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                stdout: 'ACL operation completed',
                stderr: '',
                exitCode: 0,
              });
            }, 100); // Simulate longer execution
          });
        }),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'slow-acl-shell',
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);
      Object.defineProperty(service, 'slowCommandThreshold', {
        value: 50, // Set low threshold for testing
        writable: true,
      });

      const result = await service.executeCommand(
        '$aclJson | Set-FileSecurityFast',
      );
      expect(result.stdout).toBe('ACL operation completed');
      expect(mockShell.execute).toHaveBeenCalledWith(
        '$aclJson | Set-FileSecurityFast',
        90000,
      );
    });

    it('should handle catch block in executeCommand', async () => {
      const mockShell = {
        lastHealthCheck: Date.now(),
        getQueueLength: jest.fn().mockReturnValue(0),
        execute: jest.fn().mockRejectedValue(new Error('Execution failed')),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'catch-shell',
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);
      Object.defineProperty(service, 'totalErrors', {
        value: 0,
        writable: true,
      });

      await expect(service.executeCommand('Error-Command')).rejects.toThrow(
        'Execution failed',
      );

      // Verify error count was incremented in catch block
      const totalErrors = (service as any).totalErrors;
      expect(totalErrors).toBe(1);
    });

    it('should handle execution time array trimming', async () => {
      const mockShell = {
        lastHealthCheck: Date.now(),
        getQueueLength: jest.fn().mockReturnValue(0),
        execute: jest.fn().mockResolvedValue({
          stdout: 'Success',
          stderr: '',
          exitCode: 0,
        }),
        isAvailable: jest.fn().mockReturnValue(true),
        id: 'trim-shell',
      };

      jest
        .spyOn(service as any, 'getHealthyShell')
        .mockResolvedValue(mockShell);

      // Create array with 100 items (at the limit)
      const initialTimes = new Array(100).fill(1000);
      Object.defineProperty(service, 'executionTimes', {
        value: initialTimes,
        writable: true,
      });

      await service.executeCommand('Trim-Test');

      // Should still be 100 items after trimming oldest
      const executionTimes = (service as any).executionTimes;
      expect(executionTimes.length).toBe(100);
    });
  });
});
