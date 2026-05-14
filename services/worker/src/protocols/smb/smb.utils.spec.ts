
import { SmbErrors } from './smb.protocol.type';
import { handleConnectionError, parseLinMacShares, parseProtocolVersions, parseWindowsShares, smbMountCommandWithNoatime } from './smb.utils';

describe('handleConnectionError', () => {
    it('should return the correct error message for ACCESS_DENIED', () => {
        const errorCode = SmbErrors.ACCESS_DENIED;
        const result = handleConnectionError(errorCode);
        expect(result).toBe(`Error: Unable to connect to the server - ${SmbErrors.ACCESS_DENIED}`);
    });

    it('should return the correct error message for CONNECTION_REFUSED', () => {
        const errorCode = SmbErrors.CONNECTION_REFUSED;
        const result = handleConnectionError(errorCode);
        expect(result).toBe(`Error: Not a valid SMB server - ${SmbErrors.CONNECTION_REFUSED}`);
    });

    it('should return the correct error message for LOGON_FAILURE', () => {
        const errorCode = SmbErrors.LOGON_FAILURE;
        const result = handleConnectionError(errorCode);
        expect(result).toBe(`Error: Wrong credentials - ${SmbErrors.LOGON_FAILURE}`);
    });

    it('should return the correct error message for TIMEOUT', () => {
        const errorCode = SmbErrors.TIMEOUT;
        const result = handleConnectionError(errorCode);
        expect(result).toBe(`Unable to connect to the server - ${SmbErrors.TIMEOUT}`);
    });

    it('should return the correct error message for PROTOCOL_MISMATCH', () => {
        const errorCode = SmbErrors.PROTOCOL_MISMATCH;
        const result = handleConnectionError(errorCode);
        expect(result).toBe(`Error: Protocol not supported by server - ${SmbErrors.PROTOCOL_MISMATCH}`);
    });

    it('should return the correct error message for NETWORK_UNREACHABLE', () => {
        const errorCode = SmbErrors.NETWORK_UNREACHABLE;
        const result = handleConnectionError(errorCode);
        expect(result).toBe(`Error: Network unreachable - ${SmbErrors.NETWORK_UNREACHABLE}`);
    });

    it('should return the correct error message for HOST_UNREACHABLE', () => {
        const errorCode = SmbErrors.HOST_UNREACHABLE;
        const result = handleConnectionError(errorCode);
        expect(result).toBe(`Error: Host unreachable - ${SmbErrors.HOST_UNREACHABLE}`);
    });

    it('should return the correct error message for PORT_BLOCKED', () => {
        const errorCode = SmbErrors.PORT_BLOCKED;
        const result = handleConnectionError(errorCode);
        expect(result).toBe(`Error: Protocol port blocked or not accessible - ${SmbErrors.PORT_BLOCKED}`);
    });

    it('should detect version mismatch from error message pattern', () => {
        const errorCode = 'SMB version mismatch detected';
        const result = handleConnectionError(errorCode);
        expect(result).toBe(`Error: SMB version mismatch between client and server - ${errorCode}`);
    });

    it('should detect protocol not supported from error message pattern', () => {
        const errorCode = 'protocol not supported by target';
        const result = handleConnectionError(errorCode);
        expect(result).toBe(`Error: Protocol not supported by server - ${errorCode}`);
    });

    it('should detect port blocked from error message pattern', () => {
        const errorCode = 'port 445 blocked by security policy';
        const result = handleConnectionError(errorCode);
        expect(result).toBe(`Error: Protocol port blocked or not accessible - ${errorCode}`);
    });

    it('should detect host unreachable from error message pattern', () => {
        const errorCode = 'host unreachable or not found';
        const result = handleConnectionError(errorCode);
        expect(result).toBe(`Error: Host unreachable - ${errorCode}`);
    });

    it('should detect OS not supported from error message pattern', () => {
        const errorCode = 'os not supported for this operation';
        const result = handleConnectionError(errorCode);
        expect(result).toBe(`Error: Host OS not supported for this operation - ${errorCode}`);
    });

    it('should return the default error message for an unknown error code', () => {
        const errorCode = 'UNKNOWN_ERROR';
        const result = handleConnectionError(errorCode);
        expect(result).toBe(`Unable to connect to the server - UNKNOWN_ERROR`);
    });
});



describe('parseProtocolVersions', () => {
    it('should return an empty array when output is empty', () => {
        const result = parseProtocolVersions('');
        expect(result).toEqual([]);
    });

    it('should return an empty array when output is undefined or null', () => {
        const resultNull = parseProtocolVersions(null);
        const resultUndefined = parseProtocolVersions(undefined);
        expect(resultNull).toEqual([]);
        expect(resultUndefined).toEqual([]);
    });

    it('should handle missing smb-protocols section gracefully', () => {
        const output = 'No protocols section here';
        const result = parseProtocolVersions(output);
        expect(result).toEqual([]);
    });
});

describe('parseLinMacShares', () => {
    it('should return an empty array when input is empty', () => {
        const result = parseLinMacShares('');
        expect(result).toEqual([]);
    });

    it('should correctly parse and return shares starting with "/"', () => {
        const input = 'Sharename\n---------\nIPC$\nprint$\nSMB1\nShare1\nShare2';
        const result = parseLinMacShares(input);
        expect(result).toEqual(['/Share1', '/Share2']);
    });

    it('should exclude irrelevant share names like IPC$, print$, SMB1', () => {
        const input = 'Sharename\n---------\nIPC$\nprint$\nSMB1\nvalidShare1\nvalidShare2';
        const result = parseLinMacShares(input);
        expect(result).toEqual(['/validShare1', '/validShare2']);
    });

    it('should handle shares with special characters or spaces correctly', () => {
        const input = 'Sharename\n---------\nMy Share 1\nMy-Share_2\nShare3';
        const result = parseLinMacShares(input);
        expect(result).toEqual(['/My', '/My-Share_2', '/Share3']);
    });
});

describe('parseWindowsShares', () => {
    it('should return an empty array when input is empty', () => {
        const result = parseWindowsShares('');
        expect(result).toEqual([]);
    });

    it('should correctly parse share names between "---" and "The command completed successfully"', () => {
        const input = '---\nShare1\nShare2\nShare3\nThe command completed successfully';
        const result = parseWindowsShares(input);
        expect(result).toEqual(['Share1', 'Share2', 'Share3']);
    });

    it('should exclude lines before and after the shares', () => {
        const input = 'Some random text\n---\nShare1\nShare2\nThe command completed successfully\nSome other text';
        const result = parseWindowsShares(input);
        expect(result).toEqual(['Share1', 'Share2']);
    });

    it('should handle multiline share names correctly', () => {
        const input = '---\nShareName1\nShareName2\nThe command completed successfully';
        const result = parseWindowsShares(input);
        expect(result).toEqual(['ShareName1', 'ShareName2']);
    });

    it('should return an empty array if no shares are found', () => {
        const input = 'Some irrelevant text without any shares';
        const result = parseWindowsShares(input);
        expect(result).toEqual([]);
    });
});
describe('parseProtocolVersions', () => {
    it('should return an array of protocol versions', () => {
        const output = '| smb-protocols:\n|     SMB2_02\n|     SMB2_10\n|_    SMB3_00';
        const result = parseProtocolVersions(output);
        expect(result).toEqual(['SMB2_02', 'SMB2_10', 'SMB3_00']);
    });

    it('should handle output with no protocols section', () => {
        const output = 'Some random text';
        const result = parseProtocolVersions(output);
        expect(result).toEqual([]);
    });

    it('should handle output with empty protocols section', () => {
        const output = '| smb-protocols:\n';
        const result = parseProtocolVersions(output);
        expect(result).toEqual([]);
    });

    it('should handle output with malformed protocols section', () => {
        const output = '| smb-protocols:\n|     SMB2_02\n|_';
        const result = parseProtocolVersions(output);
        expect(result).toEqual(['SMB2_02']);
    });
});

describe('parseLinMacShares', () => {
    it('should return an empty array when input is empty', () => {
        const result = parseLinMacShares('');
        expect(result).toEqual([]);
    });

    it('should correctly parse and return shares starting with "/"', () => {
        const input = 'Sharename\n---------\nIPC$\nprint$\nSMB1\nShare1\nShare2';
        const result = parseLinMacShares(input);
        expect(result).toEqual(['/Share1', '/Share2']);
    });

    it('should exclude irrelevant share names like IPC$, print$, SMB1', () => {
        const input = 'Sharename\n---------\nIPC$\nprint$\nSMB1\nvalidShare1\nvalidShare2';
        const result = parseLinMacShares(input);
        expect(result).toEqual(['/validShare1', '/validShare2']);
    });

    it('should handle shares with special characters or spaces correctly', () => {
        const input = 'Sharename\n---------\nMy Share 1\nMy-Share_2\nShare3';
        const result = parseLinMacShares(input);
        expect(result).toEqual(['/My', '/My-Share_2', '/Share3']);
    });
});

describe('parseWindowsShares', () => {
    it('should return an empty array when input is empty', () => {
        const result = parseWindowsShares('');
        expect(result).toEqual([]);
    });

    it('should correctly parse share names between "---" and "The command completed successfully"', () => {
        const input = '---\nShare1\nShare2\nShare3\nThe command completed successfully';
        const result = parseWindowsShares(input);
        expect(result).toEqual(['Share1', 'Share2', 'Share3']);
    });

    it('should exclude lines before and after the shares', () => {
        const input = 'Some random text\n---\nShare1\nShare2\nThe command completed successfully\nSome other text';
        const result = parseWindowsShares(input);
        expect(result).toEqual(['Share1', 'Share2']);
    });

    it('should handle multiline share names correctly', () => {
        const input = '---\nShareName1\nShareName2\nThe command completed successfully';
        const result = parseWindowsShares(input);
        expect(result).toEqual(['ShareName1', 'ShareName2']);
    });

    it('should return an empty array if no shares are found', () => {
        const input = 'Some irrelevant text without any shares';
        const result = parseWindowsShares(input);
        expect(result).toEqual([]);
    });
});

describe('smbMountCommandWithNoatime', () => {
    it('inserts -o noatime,nodiratime for plain `mount -t cifs` templates (Linux)', () => {
        expect(
            smbMountCommandWithNoatime('mount -t cifs //${HOST}${MOUNT_PATH} ${DIR_PATH} -o user=${USERNAME}'),
        ).toBe('mount -t cifs -o noatime,nodiratime //${HOST}${MOUNT_PATH} ${DIR_PATH} -o user=${USERNAME}');
    });

    it('inserts -o noatime,nodiratime for `mount.cifs` templates (Linux)', () => {
        expect(
            smbMountCommandWithNoatime('mount.cifs //${HOST}${MOUNT_PATH} ${DIR_PATH}'),
        ).toBe('mount.cifs -o noatime,nodiratime //${HOST}${MOUNT_PATH} ${DIR_PATH}');
    });

    it('inserts -o noatime (only) for `mount -t smbfs` templates (macOS)', () => {
        // macOS smbfs honours noatime but not nodiratime; do not add the latter.
        expect(
            smbMountCommandWithNoatime('mount -t smbfs //${USERNAME}@${HOST}${MOUNT_PATH} ${DIR_PATH}'),
        ).toBe('mount -t smbfs -o noatime //${USERNAME}@${HOST}${MOUNT_PATH} ${DIR_PATH}');
    });

    it('inserts -o noatime for `mount_smbfs` templates (macOS)', () => {
        expect(
            smbMountCommandWithNoatime('mount_smbfs //${USERNAME}@${HOST}${MOUNT_PATH} ${DIR_PATH}'),
        ).toBe('mount_smbfs -o noatime //${USERNAME}@${HOST}${MOUNT_PATH} ${DIR_PATH}');
    });

    it('returns unchanged when noatime is already present in the option list', () => {
        const cmd = 'mount -t cifs -o rw,noatime //host/share /mnt';
        expect(smbMountCommandWithNoatime(cmd)).toBe(cmd);
    });

    it('returns unchanged when nodiratime is already present', () => {
        const cmd = 'mount -t cifs -o rw,nodiratime //host/share /mnt';
        expect(smbMountCommandWithNoatime(cmd)).toBe(cmd);
    });

    it('returns unchanged for Windows `net use` style templates (no atime knob)', () => {
        const cmd = 'net use Z: \\\\${HOST}${MOUNT_PATH} ${PASSWORD} /USER:${USERNAME}';
        expect(smbMountCommandWithNoatime(cmd)).toBe(cmd);
    });

    it('returns unchanged for unrelated commands (e.g. NFS templates) so callers can apply both rewriters safely', () => {
        const cmd = 'mount -t nfs ${HOST}:${MOUNT_PATH} ${DIR_PATH}';
        expect(smbMountCommandWithNoatime(cmd)).toBe(cmd);
    });

    it('returns the input unchanged when null/empty', () => {
        expect(smbMountCommandWithNoatime('')).toBe('');
        expect(smbMountCommandWithNoatime(undefined as unknown as string)).toBe(undefined);
    });

    it('is idempotent: applying twice yields the same result as once', () => {
        const original = 'mount -t cifs //host/share /mnt';
        const once = smbMountCommandWithNoatime(original);
        const twice = smbMountCommandWithNoatime(once);
        expect(twice).toBe(once);
    });
});
