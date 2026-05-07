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

    describe('checkBackupOperatorMembership()', () => {
        describe('on non-Windows platform', () => {
            beforeEach(() => {
                Object.defineProperty(process, 'platform', {
                    value: 'linux',
                    configurable: true,
                });
            });

            it('should return NOT_DOMAIN_JOINED without executing PowerShell', async () => {
                const result = await service.checkBackupOperatorMembership('trace-1', 'user', 'pass');

                expect(result).toBe('NOT_DOMAIN_JOINED');
                expect(mockExecAsync).not.toHaveBeenCalled();
            });
        });

        describe('on Windows platform', () => {
            beforeEach(() => {
                Object.defineProperty(process, 'platform', {
                    value: 'win32',
                    configurable: true,
                });
            });

            it('should return IS_MEMBER when user is a Backup Operators member', async () => {
                mockExecAsync.mockResolvedValue({ stdout: 'IS_MEMBER', stderr: '' });

                const result = await service.checkBackupOperatorMembership('trace-1', 'user', 'pass');

                expect(result).toBe('IS_MEMBER');
                expect(mockExecAsync).toHaveBeenCalledTimes(1);
                expect(mockExecAsync).toHaveBeenCalledWith(
                    expect.stringContaining('-EncodedCommand'),
                    expect.objectContaining({ windowsHide: true, timeout: 15000, env: expect.objectContaining({ NDM_SMB_PASSWORD: 'pass' }) })
                );
            });

            it('should return NOT_MEMBER when user is not in Backup Operators', async () => {
                mockExecAsync.mockResolvedValue({ stdout: 'NOT_MEMBER', stderr: '' });

                const result = await service.checkBackupOperatorMembership('trace-2', 'user', 'pass');

                expect(result).toBe('NOT_MEMBER');
            });

            it('should return NOT_DOMAIN_JOINED when machine is not domain-joined', async () => {
                mockExecAsync.mockResolvedValue({ stdout: 'NOT_DOMAIN_JOINED', stderr: '' });

                const result = await service.checkBackupOperatorMembership('trace-3', 'user', 'pass');

                expect(result).toBe('NOT_DOMAIN_JOINED');
            });

            it('should return ERROR when PowerShell throws an error', async () => {
                mockExecAsync.mockRejectedValue(new Error('PowerShell execution failed'));

                const result = await service.checkBackupOperatorMembership('trace-4', 'user', 'pass');

                expect(result).toBe('ERROR');
                expect(service['logger'].error).toHaveBeenCalledWith(
                    expect.stringContaining('Error checking Backup Operators membership')
                );
            });

            it('should return ERROR when PS script outputs ERROR (LDAP failure)', async () => {
                mockExecAsync.mockResolvedValue({ stdout: 'ERROR', stderr: '' });

                const result = await service.checkBackupOperatorMembership('trace-4b', 'user', 'pass');

                expect(result).toBe('ERROR');
                expect(service['logger'].error).toHaveBeenCalledWith(
                    expect.stringContaining('LDAP/AD failure')
                );
            });

            it('should log a warning when stderr is non-empty', async () => {
                mockExecAsync.mockResolvedValue({ stdout: 'IS_MEMBER', stderr: 'some stderr output' });

                await service.checkBackupOperatorMembership('trace-5', 'user', 'pass');

                expect(service['logger'].warn).toHaveBeenCalledWith(
                    expect.stringContaining('stderr during group check')
                );
            });

            it('should encode the PowerShell script as base64 utf16le', async () => {
                mockExecAsync.mockResolvedValue({ stdout: 'IS_MEMBER', stderr: '' });

                await service.checkBackupOperatorMembership('trace-6', 'user', 'pass');

                const calledArg = mockExecAsync.mock.calls[0][0] as string;
                const encodedPart = calledArg.split('-EncodedCommand ')[1];
                const decoded = Buffer.from(encodedPart, 'base64').toString('utf16le');
                expect(decoded).toContain('Backup Operators');
                expect(decoded).toContain('Win32_ComputerSystem');
                expect(decoded).toContain('sAMAccountName=$escapedSam');
                expect(decoded).toContain('distinguishedName');
            });

            it('should use Get-CimInstance instead of the deprecated Get-WmiObject', async () => {
                mockExecAsync.mockResolvedValue({ stdout: 'IS_MEMBER', stderr: '' });

                await service.checkBackupOperatorMembership('trace-cim', 'user', 'pass');

                const calledArg = mockExecAsync.mock.calls[0][0] as string;
                const encodedPart = calledArg.split('-EncodedCommand ')[1];
                const decoded = Buffer.from(encodedPart, 'base64').toString('utf16le');
                expect(decoded).toContain('Get-CimInstance');
                expect(decoded).not.toContain('Get-WmiObject');
            });

            it('should use the LDAP_MATCHING_RULE_IN_CHAIN OID for recursive (nested) group membership', async () => {
                mockExecAsync.mockResolvedValue({ stdout: 'IS_MEMBER', stderr: '' });

                await service.checkBackupOperatorMembership('trace-nested', 'user', 'pass');

                const calledArg = mockExecAsync.mock.calls[0][0] as string;
                const encodedPart = calledArg.split('-EncodedCommand ')[1];
                const decoded = Buffer.from(encodedPart, 'base64').toString('utf16le');
                // OID 1.2.840.113556.1.4.1941 enables recursive member-of resolution in AD
                expect(decoded).toContain('1.2.840.113556.1.4.1941');
                expect(decoded).toContain('memberOf:1.2.840.113556.1.4.1941:=');
            });

            it('should escape single quotes in username to prevent script injection', async () => {
                mockExecAsync.mockResolvedValue({ stdout: 'IS_MEMBER', stderr: '' });

                await service.checkBackupOperatorMembership('trace-7', "user'name", "pa'ss");

                const calledArg = mockExecAsync.mock.calls[0][0] as string;
                const encodedPart = calledArg.split('-EncodedCommand ')[1];
                const decoded = Buffer.from(encodedPart, 'base64').toString('utf16le');
                // Username single quotes are doubled in the PS script
                expect(decoded).toContain("user''name");
                // Password is passed via env var — must NOT appear in the encoded script
                expect(decoded).not.toContain("pa'ss");
                expect(decoded).not.toContain("pa''ss");
                // Password is in the env var instead
                const callOptions = mockExecAsync.mock.calls[0][1] as any;
                expect(callOptions.env.NDM_SMB_PASSWORD).toBe("pa'ss");
            });

            it('should use -NoProfile -NonInteractive flags', async () => {
                mockExecAsync.mockResolvedValue({ stdout: 'IS_MEMBER', stderr: '' });

                await service.checkBackupOperatorMembership('trace-8', 'user', 'pass');

                expect(mockExecAsync).toHaveBeenCalledWith(
                    expect.stringContaining('-NoProfile -NonInteractive -EncodedCommand'),
                    expect.any(Object)
                );
            });

            it('should return NOT_MEMBER when stdout contains unexpected output', async () => {
                mockExecAsync.mockResolvedValue({ stdout: 'some unexpected output', stderr: '' });

                const result = await service.checkBackupOperatorMembership('trace-9', 'user', 'pass');

                expect(result).toBe('NOT_MEMBER');
            });

            it('should log the membership result', async () => {
                mockExecAsync.mockResolvedValue({ stdout: 'IS_MEMBER', stderr: '' });

                await service.checkBackupOperatorMembership('trace-10', 'user', 'pass');

                expect(service['logger'].log).toHaveBeenCalledWith(
                    expect.stringContaining('Backup Operators check output: IS_MEMBER')
                );
            });
        });
    });
});
