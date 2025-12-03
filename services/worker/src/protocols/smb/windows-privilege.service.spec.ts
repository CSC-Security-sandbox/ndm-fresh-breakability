import { Test, TestingModule } from '@nestjs/testing';

// Create mock before everything else
const mockExecAsync = jest.fn();

// Mock util.promisify at module level to return our mock
jest.mock('util', () => ({
    promisify: jest.fn(() => mockExecAsync),
}));

jest.mock('child_process');
jest.mock('fs', () => ({
    promises: {
        writeFile: jest.fn(),
        unlink: jest.fn(),
        access: jest.fn(),
        mkdir: jest.fn(),
    },
}));
jest.mock('os', () => ({
    tmpdir: jest.fn().mockReturnValue('C:\\temp'),
}));
jest.mock('path', () => ({
    join: jest.fn((...args: string[]) => args.join('\\')),
}));

// Now import the service after ALL mocks are set up
import { WindowsPrivilegeService } from './windows-privilege.service';

// Get references to the mocked modules
const mockFs = require('fs');
const mockOs = require('os');
const mockPath = require('path');

describe('WindowsPrivilegeService', () => {
    let service: WindowsPrivilegeService;
    let originalPlatform: PropertyDescriptor;

    beforeEach(async () => {
        // Save original platform
        originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

        // Reset mocks
        jest.clearAllMocks();
        
        // Reset fs.promises mocks to default resolved values
        mockFs.promises.writeFile.mockResolvedValue(undefined);
        mockFs.promises.unlink.mockResolvedValue(undefined);

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

            const result = await service.enableBackupPrivileges('test-job-123');

            expect(result).toBe(true);
            expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
                expect.stringContaining('enable_privs_'),
                expect.stringContaining('EnablePrivilegeForPid'),
                'utf8'
            );
            expect(mockExecAsync).toHaveBeenCalledWith(
                expect.stringContaining('powershell -NoProfile -ExecutionPolicy Bypass -File'),
                expect.any(Object)
            );
            expect(mockFs.promises.unlink).toHaveBeenCalled();
        });

        it('should return false when privilege enablement fails', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: 'SeBackupPrivilege: FAILED: Access denied\nSeRestorePrivilege: FAILED: Access denied\nOVERALL: FAILED',
                stderr: '',
            });

            const result = await service.enableBackupPrivileges('test-job-123');

            expect(result).toBe(false);
        });

        it('should cache privilege state and skip re-enablement', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: 'SeBackupPrivilege: SUCCESS\nSeRestorePrivilege: SUCCESS\nOVERALL: SUCCESS',
                stderr: '',
            });

            // First call
            const result1 = await service.enableBackupPrivileges('test-job-123');
            expect(result1).toBe(true);
            expect(mockExecAsync).toHaveBeenCalledTimes(1);

            // Second call - should skip execution
            const result2 = await service.enableBackupPrivileges('test-job-456');
            expect(result2).toBe(true);
            expect(mockExecAsync).toHaveBeenCalledTimes(1); // Still only called once
        });

        it('should handle PowerShell execution errors', async () => {
            mockExecAsync.mockRejectedValue(new Error('PowerShell not found'));

            const result = await service.enableBackupPrivileges('test-job-123');

            expect(result).toBe(false);
        });

        it('should handle PowerShell stderr output', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: 'SeBackupPrivilege: SUCCESS\nSeRestorePrivilege: SUCCESS\nOVERALL: SUCCESS',
                stderr: 'Warning: Some non-critical warning',
            });

            const result = await service.enableBackupPrivileges('test-job-123');

            expect(result).toBe(true);
        });

        it('should clean up temp file even on error', async () => {
            mockExecAsync.mockRejectedValue(new Error('Execution failed'));

            await service.enableBackupPrivileges('test-job-123');

            expect(mockFs.promises.unlink).toHaveBeenCalled();
        });

        it('should return false on non-Windows platforms', async () => {
            Object.defineProperty(process, 'platform', {
                value: 'linux',
                configurable: true,
            });

            const result = await service.enableBackupPrivileges('test-job-123');

            expect(result).toBe(false);
            expect(mockExecAsync).not.toHaveBeenCalled();
        });

        it('should handle partial success', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: 'SeBackupPrivilege: SUCCESS\nSeRestorePrivilege: FAILED: Access denied\nOVERALL: FAILED',
                stderr: '',
            });

            const result = await service.enableBackupPrivileges('test-job-123');

            expect(result).toBe(false);
        });

        it('should pass correct process ID to PowerShell script', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: 'SeBackupPrivilege: SUCCESS\nSeRestorePrivilege: SUCCESS\nOVERALL: SUCCESS',
                stderr: '',
            });

            await service.enableBackupPrivileges('test-job-123');

            expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining(`$targetPid = ${process.pid}`),
                'utf8'
            );
        });

        it('should use correct PowerShell execution flags', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: 'SeBackupPrivilege: SUCCESS\nSeRestorePrivilege: SUCCESS\nOVERALL: SUCCESS',
                stderr: '',
            });

            await service.enableBackupPrivileges('test-job-123');

            expect(mockExecAsync).toHaveBeenCalledWith(
                expect.stringContaining('-NoProfile -ExecutionPolicy Bypass'),
                expect.objectContaining({ windowsHide: true })
            );
        });

        it('should handle empty stdout', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: '',
                stderr: '',
            });

            const result = await service.enableBackupPrivileges('test-job-123');

            expect(result).toBe(false);
        });

        it('should handle file write errors', async () => {
            mockFs.promises.writeFile.mockRejectedValue(new Error('Disk full'));

            const result = await service.enableBackupPrivileges('test-job-123');

            expect(result).toBe(false);
            expect(mockExecAsync).not.toHaveBeenCalled();
        });

        it('should create temp file with job run ID in filename', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: 'SeBackupPrivilege: SUCCESS\nSeRestorePrivilege: SUCCESS\nOVERALL: SUCCESS',
                stderr: '',
            });

            await service.enableBackupPrivileges('test-job-123');

            expect(mockPath.join).toHaveBeenCalledWith(
                'C:\\temp',
                'enable_privs_test-job-123.ps1'
            );
            expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
                'C:\\temp\\enable_privs_test-job-123.ps1',
                expect.any(String),
                'utf8'
            );
        });

        it('should handle cleanup errors gracefully', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: 'SeBackupPrivilege: SUCCESS\nSeRestorePrivilege: SUCCESS\nOVERALL: SUCCESS',
                stderr: '',
            });
            mockFs.promises.unlink.mockRejectedValue(new Error('File locked'));

            const result = await service.enableBackupPrivileges('test-job-123');

            // Should still return true even if cleanup fails
            expect(result).toBe(true);
            expect(service['logger'].error).toHaveBeenCalledWith(
                expect.stringContaining('Error deleting PowerShell script file')
            );
        });
    });
});
