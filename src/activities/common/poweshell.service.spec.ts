import { Test, TestingModule } from '@nestjs/testing';
import { PowerShellService } from './poweshell.service';
import { Logger } from '@nestjs/common';
import { ChildProcessWithoutNullStreams } from 'child_process';
import { Readable, Writable } from 'stream';

describe('PowerShellService', () => {
  let service: PowerShellService;
  let mockLogger: Partial<Logger>;
  let mockChildProcess: Partial<ChildProcessWithoutNullStreams>;

  beforeEach(async () => {
    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Create mock streams
    const mockStdout = new Readable({ read() {} });
    const mockStderr = new Readable({ read() {} });
    const mockStdin = new Writable({ write(chunk, encoding, callback) { callback() } });

    mockChildProcess = {
      stdout: mockStdout,
      stderr: mockStderr,
      stdin: mockStdin,
      kill: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PowerShellService,
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<PowerShellService>(PowerShellService);
  });

  describe('onModuleInit', () => {
    it('should warn if not running on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
      service.onModuleInit();
      expect(mockLogger.warn).toHaveBeenCalledWith('PowerShell service is only supported on Windows.');
    });
  });

  describe('runCommand', () => {
    it('should throw an error if not running on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
      await expect(service.runCommand('Get-Process')).rejects.toThrow('PowerShell is only supported on Windows.');
    });

    it('should handle errors from PowerShell', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
      service['ps'] = mockChildProcess as any; // Set the mock child process

      const command = 'Get-Process';
      const expectedError = 'PowerShell is only supported on Windows.';
      mockChildProcess.stderr.on = jest.fn((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from(expectedError));
        }
        return mockChildProcess.stderr; // Return the stream itself
      });

      await expect(service.runCommand(command)).rejects.toThrow(expectedError);
    });
  });

  describe('onModuleDestroy', () => {
    it('should not stop the process if not running on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
      service.onModuleDestroy();
      expect(mockLogger.log).not.toHaveBeenCalled();
    });
  });
});
