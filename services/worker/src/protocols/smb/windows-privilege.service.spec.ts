import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter } from 'events';

// Create a proper mock stdin with write and end methods
class MockStdin extends EventEmitter {
    write = jest.fn();
    end = jest.fn();
}

// Mock spawn function - will be configured per test
let mockStdin: MockStdin;
let mockStdout: EventEmitter;
let mockStderr: EventEmitter;
let mockChildProcess: any;

const mockSpawn = jest.fn(() => mockChildProcess);

jest.mock('child_process', () => ({
    spawn: mockSpawn,
}));

// Now import the service after mocks are set up
import { WindowsPrivilegeService } from './windows-privilege.service';

describe('WindowsPrivilegeService', () => {
    let service: WindowsPrivilegeService;
    let originalPlatform: PropertyDescriptor;

    beforeEach(async () => {
        // Save original platform
        originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

        // Create fresh mock instances for each test
        mockStdin = new MockStdin();
        mockStdout = new EventEmitter();
        mockStderr = new EventEmitter();
        
        mockChildProcess = Object.assign(new EventEmitter(), {
            stdout: mockStdout,
            stderr: mockStderr,
            stdin: mockStdin,
        });

        // Reset mocks
        jest.clearAllMocks();
        mockSpawn.mockReturnValue(mockChildProcess);

        const module: TestingModule = await Test.createTestingModule({
            providers: [WindowsPrivilegeService],
        }).compile();

        service = module.get<WindowsPrivilegeService>(WindowsPrivilegeService);

        // Mock logger to suppress console output during tests
        jest.spyOn(service['logger'], 'log').mockImplementation();
        jest.spyOn(service['logger'], 'error').mockImplementation();
        jest.spyOn(service['logger'], 'warn').mockImplementation();
        jest.spyOn(service['logger'], 'debug').mockImplementation();
    });

    afterEach(() => {
        // Restore original platform
        Object.defineProperty(process, 'platform', originalPlatform);
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    describe('enableBackupPrivileges()', () => {
        beforeEach(() => {
            // Set platform to Windows
            Object.defineProperty(process, 'platform', {
                value: 'win32',
                configurable: true,
            });
        });

        it('should enable backup privileges successfully', async () => {
            // Start the async call
            const resultPromise = service.enableBackupPrivileges();

            // Simulate PowerShell process execution
            process.nextTick(() => {
                mockStdout.emit('data', Buffer.from('SeBackupPrivilege: SUCCESS\n'));
                mockStdout.emit('data', Buffer.from('SeRestorePrivilege: SUCCESS\n'));
                mockChildProcess.emit('close', 0);
            });

            const result = await resultPromise;

            expect(result).toBe(true);
            expect(mockSpawn).toHaveBeenCalledWith(
                'powershell',
                ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
                { windowsHide: true }
            );
            expect(mockStdin.write).toHaveBeenCalledWith(expect.stringContaining('EnablePrivilegeForPid'));
            expect(mockStdin.end).toHaveBeenCalled();
        });

        it('should return false when privilege enablement fails', async () => {
            const resultPromise = service.enableBackupPrivileges();

            process.nextTick(() => {
                mockStdout.emit('data', Buffer.from('SeBackupPrivilege: FAILED: Access denied\n'));
                mockStdout.emit('data', Buffer.from('SeRestorePrivilege: FAILED: Access denied\n'));
                mockChildProcess.emit('close', 0);
            });

            const result = await resultPromise;

            expect(result).toBe(false);
        });

        it('should cache privilege state and skip re-enablement', async () => {
            // First call
            const resultPromise1 = service.enableBackupPrivileges();

            process.nextTick(() => {
                mockStdout.emit('data', Buffer.from('SeBackupPrivilege: SUCCESS\n'));
                mockStdout.emit('data', Buffer.from('SeRestorePrivilege: SUCCESS\n'));
                mockChildProcess.emit('close', 0);
            });

            const result1 = await resultPromise1;
            expect(result1).toBe(true);
            expect(mockSpawn).toHaveBeenCalledTimes(1);

            // Second call - should skip execution
            const result2 = await service.enableBackupPrivileges();
            expect(result2).toBe(true);
            expect(mockSpawn).toHaveBeenCalledTimes(1); // Still only called once
        });

        it('should handle PowerShell spawn errors', async () => {
            const resultPromise = service.enableBackupPrivileges();

            process.nextTick(() => {
                mockChildProcess.emit('error', new Error('PowerShell not found'));
            });

            const result = await resultPromise;

            expect(result).toBe(false);
        });

        it('should handle PowerShell stderr output', async () => {
            const resultPromise = service.enableBackupPrivileges();

            process.nextTick(() => {
                mockStderr.emit('data', Buffer.from('Warning: Some non-critical warning\n'));
                mockStdout.emit('data', Buffer.from('SeBackupPrivilege: SUCCESS\n'));
                mockStdout.emit('data', Buffer.from('SeRestorePrivilege: SUCCESS\n'));
                mockChildProcess.emit('close', 0);
            });

            const result = await resultPromise;

            expect(result).toBe(true);
        });

        it('should handle PowerShell non-zero exit code', async () => {
            const resultPromise = service.enableBackupPrivileges();

            process.nextTick(() => {
                mockStdout.emit('data', Buffer.from('Some error occurred\n'));
                mockChildProcess.emit('close', 1);
            });

            const result = await resultPromise;

            expect(result).toBe(false);
        });

        it('should return false on non-Windows platforms', async () => {
            Object.defineProperty(process, 'platform', {
                value: 'linux',
                configurable: true,
            });

            const result = await service.enableBackupPrivileges();

            expect(result).toBe(false);
            expect(mockSpawn).not.toHaveBeenCalled();
        });

        it('should handle partial success (only backup privilege)', async () => {
            const resultPromise = service.enableBackupPrivileges();

            process.nextTick(() => {
                mockStdout.emit('data', Buffer.from('SeBackupPrivilege: SUCCESS\n'));
                mockStdout.emit('data', Buffer.from('SeRestorePrivilege: FAILED: Access denied\n'));
                mockChildProcess.emit('close', 0);
            });

            const result = await resultPromise;

            expect(result).toBe(false);
        });

        it('should handle partial success (only restore privilege)', async () => {
            const resultPromise = service.enableBackupPrivileges();

            process.nextTick(() => {
                mockStdout.emit('data', Buffer.from('SeBackupPrivilege: FAILED: Access denied\n'));
                mockStdout.emit('data', Buffer.from('SeRestorePrivilege: SUCCESS\n'));
                mockChildProcess.emit('close', 0);
            });

            const result = await resultPromise;

            expect(result).toBe(false);
        });

        it('should pass correct process ID to PowerShell script', async () => {
            const resultPromise = service.enableBackupPrivileges();

            process.nextTick(() => {
                mockStdout.emit('data', Buffer.from('SeBackupPrivilege: SUCCESS\n'));
                mockStdout.emit('data', Buffer.from('SeRestorePrivilege: SUCCESS\n'));
                mockChildProcess.emit('close', 0);
            });

            await resultPromise;

            expect(mockStdin.write).toHaveBeenCalledWith(
                expect.stringContaining(`$targetPid = ${process.pid}`)
            );
        });

        it('should use correct PowerShell execution flags', async () => {
            const resultPromise = service.enableBackupPrivileges();

            process.nextTick(() => {
                mockStdout.emit('data', Buffer.from('SeBackupPrivilege: SUCCESS\n'));
                mockStdout.emit('data', Buffer.from('SeRestorePrivilege: SUCCESS\n'));
                mockChildProcess.emit('close', 0);
            });

            await resultPromise;

            expect(mockSpawn).toHaveBeenCalledWith(
                'powershell',
                expect.arrayContaining(['-NoProfile', '-ExecutionPolicy', 'Bypass']),
                expect.objectContaining({ windowsHide: true })
            );
        });

        it('should handle empty stdout', async () => {
            const resultPromise = service.enableBackupPrivileges();

            process.nextTick(() => {
                mockChildProcess.emit('close', 0);
            });

            const result = await resultPromise;

            expect(result).toBe(false);
        });

        it('should handle stdin write errors', async () => {
            const resultPromise = service.enableBackupPrivileges();

            process.nextTick(() => {
                mockStdin.emit('error', new Error('Failed to write to stdin'));
            });

            const result = await resultPromise;

            expect(result).toBe(false);
        });

        it('should write PowerShell script to stdin', async () => {
            const resultPromise = service.enableBackupPrivileges();

            process.nextTick(() => {
                mockStdout.emit('data', Buffer.from('SeBackupPrivilege: SUCCESS\n'));
                mockStdout.emit('data', Buffer.from('SeRestorePrivilege: SUCCESS\n'));
                mockChildProcess.emit('close', 0);
            });

            await resultPromise;

            expect(mockStdin.write).toHaveBeenCalledWith(
                expect.stringContaining('EnablePrivilegeForPid')
            );
            expect(mockStdin.write).toHaveBeenCalledWith(
                expect.stringContaining('SeBackupPrivilege')
            );
            expect(mockStdin.write).toHaveBeenCalledWith(
                expect.stringContaining('SeRestorePrivilege')
            );
            expect(mockStdin.end).toHaveBeenCalled();
        });

        it('should resolve promise only once when both error and close events fire', async () => {
            const resultPromise = service.enableBackupPrivileges();

            process.nextTick(() => {
                // Simulate both error and close events firing (race condition)
                mockChildProcess.emit('error', new Error('Spawn error'));
                mockChildProcess.emit('close', 1);
            });

            const result = await resultPromise;

            // Should resolve with false (from error event) and not throw
            expect(result).toBe(false);
        });

        it('should resolve promise only once when stdin error and close events fire', async () => {
            const resultPromise = service.enableBackupPrivileges();

            process.nextTick(() => {
                // Simulate stdin error followed by close event
                mockStdin.emit('error', new Error('stdin write failed'));
                mockStdout.emit('data', Buffer.from('SeBackupPrivilege: SUCCESS\n'));
                mockStdout.emit('data', Buffer.from('SeRestorePrivilege: SUCCESS\n'));
                mockChildProcess.emit('close', 0);
            });

            const result = await resultPromise;

            // Should resolve with false (from stdin error) and ignore close event result
            expect(result).toBe(false);
        });
    });
});
