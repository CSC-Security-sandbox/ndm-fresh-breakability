import { Test, TestingModule } from '@nestjs/testing';

// Create mock before everything else
const mockExecAsync = jest.fn();

// Mock util.promisify at module level to return our mock
jest.mock('util', () => ({
    promisify: jest.fn(() => mockExecAsync),
}));

jest.mock('child_process');

// Now import the service after ALL mocks are set up
import { WindowsPrivilegeService } from './windows-privilege.service';

describe('WindowsPrivilegeService', () => {
    let service: WindowsPrivilegeService;
    let originalPlatform: PropertyDescriptor;

    beforeEach(async () => {
        // Save original platform
        originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

        // Reset mocks
        jest.clearAllMocks();

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
            mockExecAsync.mockResolvedValue({
                stdout: 'SeBackupPrivilege: SUCCESS\nSeRestorePrivilege: SUCCESS\nOVERALL: SUCCESS',
                stderr: '',
            });

            await expect(service.enableBackupPrivileges('test-job-123')).resolves.toBeUndefined();

            expect(mockExecAsync).toHaveBeenCalledWith(
                expect.stringContaining('-EncodedCommand'),
                expect.objectContaining({ windowsHide: true })
            );
        });

        it('should throw error when privilege enablement fails', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: 'SeBackupPrivilege: FAILED: Access denied\nSeRestorePrivilege: FAILED: Access denied\nOVERALL: FAILED',
                stderr: '',
            });

            await expect(service.enableBackupPrivileges('test-job-123')).rejects.toThrow(
                'Failed to enable backup privileges'
            );
        });

        it('should cache privilege state and skip re-enablement', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: 'SeBackupPrivilege: SUCCESS\nSeRestorePrivilege: SUCCESS\nOVERALL: SUCCESS',
                stderr: '',
            });

            // First call
            await expect(service.enableBackupPrivileges('test-job-123')).resolves.toBeUndefined();
            expect(mockExecAsync).toHaveBeenCalledTimes(1);

            // Second call - should skip execution
            await expect(service.enableBackupPrivileges('test-job-456')).resolves.toBeUndefined();
            expect(mockExecAsync).toHaveBeenCalledTimes(1); // Still only called once
        });

        it('should throw error on PowerShell execution errors', async () => {
            mockExecAsync.mockRejectedValue(new Error('PowerShell not found'));

            await expect(service.enableBackupPrivileges('test-job-123')).rejects.toThrow(
                'Failed to enable Windows backup privileges'
            );
        });

        it('should handle PowerShell stderr output', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: 'SeBackupPrivilege: SUCCESS\nSeRestorePrivilege: SUCCESS\nOVERALL: SUCCESS',
                stderr: 'Warning: Some non-critical warning',
            });

            await expect(service.enableBackupPrivileges('test-job-123')).resolves.toBeUndefined();
        });

        it('should skip privilege enablement on non-Windows platforms', async () => {
            Object.defineProperty(process, 'platform', {
                value: 'linux',
                configurable: true,
            });

            await expect(service.enableBackupPrivileges('test-job-123')).resolves.toBeUndefined();

            expect(mockExecAsync).not.toHaveBeenCalled();
        });

        it('should throw error on partial success', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: 'SeBackupPrivilege: SUCCESS\nSeRestorePrivilege: FAILED: Access denied\nOVERALL: FAILED',
                stderr: '',
            });

            await expect(service.enableBackupPrivileges('test-job-123')).rejects.toThrow(
                'Failed to enable backup privileges'
            );
        });

        it('should pass correct process ID in encoded command', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: 'SeBackupPrivilege: SUCCESS\nSeRestorePrivilege: SUCCESS\nOVERALL: SUCCESS',
                stderr: '',
            });

            await service.enableBackupPrivileges('test-job-123');

            const calledWith = mockExecAsync.mock.calls[0][0] as string;
            const encodedPart = calledWith.split('-EncodedCommand ')[1];
            const decoded = Buffer.from(encodedPart, 'base64').toString('utf16le');
            expect(decoded).toContain(`$targetPid = ${process.pid}`);
        });

        it('should use correct PowerShell execution flags', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: 'SeBackupPrivilege: SUCCESS\nSeRestorePrivilege: SUCCESS\nOVERALL: SUCCESS',
                stderr: '',
            });

            await service.enableBackupPrivileges('test-job-123');

            expect(mockExecAsync).toHaveBeenCalledWith(
                expect.stringContaining('-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand'),
                expect.objectContaining({ windowsHide: true })
            );
        });

        it('should throw error on empty stdout', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: '',
                stderr: '',
            });

            await expect(service.enableBackupPrivileges('test-job-123')).rejects.toThrow(
                'Failed to enable backup privileges'
            );
        });

        it('should throw error on PowerShell exec failure', async () => {
            mockExecAsync.mockRejectedValue(new Error('Execution failed'));

            await expect(service.enableBackupPrivileges('test-job-123')).rejects.toThrow(
                'Failed to enable Windows backup privileges'
            );
        });

        it('should invoke execAsync exactly once with no file I/O', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: 'SeBackupPrivilege: SUCCESS\nSeRestorePrivilege: SUCCESS\nOVERALL: SUCCESS',
                stderr: '',
            });

            await service.enableBackupPrivileges('test-job-123');

            // Only one execAsync call — no separate file write or cleanup calls
            expect(mockExecAsync).toHaveBeenCalledTimes(1);
            const calledWith = mockExecAsync.mock.calls[0][0] as string;
            expect(calledWith).toContain('-EncodedCommand');
            expect(calledWith).not.toContain('-File');
        });
    });
});
