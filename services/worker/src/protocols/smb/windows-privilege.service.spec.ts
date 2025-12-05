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

            await expect(service.enableBackupPrivileges('test-job-123')).resolves.toBeUndefined();

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

        it('should clean up temp file even on error', async () => {
            mockExecAsync.mockRejectedValue(new Error('Execution failed'));

            await expect(service.enableBackupPrivileges('test-job-123')).rejects.toThrow();

            expect(mockFs.promises.unlink).toHaveBeenCalled();
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

        it('should throw error on empty stdout', async () => {
            mockExecAsync.mockResolvedValue({
                stdout: '',
                stderr: '',
            });

            await expect(service.enableBackupPrivileges('test-job-123')).rejects.toThrow(
                'Failed to enable backup privileges'
            );
        });

        it('should throw error on file write errors', async () => {
            mockFs.promises.writeFile.mockRejectedValue(new Error('Disk full'));

            await expect(service.enableBackupPrivileges('test-job-123')).rejects.toThrow(
                'Failed to enable Windows backup privileges'
            );
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

            // Should still succeed even if cleanup fails
            await expect(service.enableBackupPrivileges('test-job-123')).resolves.toBeUndefined();
            
            expect(service['logger'].error).toHaveBeenCalledWith(
                expect.stringContaining('Error deleting PowerShell script file')
            );
        });
    });
});
