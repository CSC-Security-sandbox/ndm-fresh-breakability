import { ConfigService } from '@nestjs/config';
import cmdConfig, { CommandConfig } from './command.config';

const mockConfigService = {
  get: jest.fn()
} as unknown as jest.Mocked<ConfigService>;

describe('Command Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const clearEnvVars = () => {
    delete process.env.NFS_WIN_LIST_PATH_CMD;
    delete process.env.NFS_LINUX_LIST_PATH_CMD;
    delete process.env.NFS_UNIX_LIST_PATH_CMD;
    delete process.env.NFS_LINUX_MOUNT_PATH_CMD;
    delete process.env.NFS_UNIX_MOUNT_PATH_CMD;
    delete process.env.NFS_LINUX_CHECK_MOUNT_PATH_CMD;
    delete process.env.NFS_UNIX_CHECK_MOUNT_PATH_CMD;

    delete process.env.SMB_WIN_VALIDATE_CRED_CMD;
    delete process.env.SMB_WIN_LIST_PATH_CMD;
    delete process.env.SMB_LINUX_LIST_PATH_CMD;
    delete process.env.SMB_UNIX_LIST_PATH_CMD;
    delete process.env.SMB_LINUX_MOUNT_PATH_CMD;
    delete process.env.SMB_UNIX_MOUNT_PATH_CMD;

    delete process.env.WIN_USED_DISK_SPACE;
  };

  it('should return default values when no environment variables are set', () => {
    clearEnvVars();
    const config = cmdConfig();
    expect(config).toMatchObject({
      nfs: {
        win32: {
          listPath: undefined,
          mountPath: undefined,
          unmountPath: undefined,
          versionDetails: undefined,
          availableDiskSpace: undefined,
          mountedFolderSize: undefined,
        },
        linux: {
          listPath: undefined,
          mountPath: undefined,
          checkMountPath: undefined,
          versionDetails: undefined,
          unmountPath: undefined,
          availableDiskSpace: undefined,
          mountedFolderSize: undefined,
        },
        darwin: {
          listPath: undefined,
          mountPath: undefined,
          checkMountPath: undefined,
          versionDetails: undefined,
          unmountPath: undefined,
          availableDiskSpace: undefined,
          mountedFolderSize: undefined,
        },
      },
      smb: {
        win32: {
          validateCred: undefined,
          listPath: undefined,
          mountPath: undefined,
          versionDetails: undefined,
          unmountPath: undefined,
          linkPath: undefined,
          unlinkPath: undefined,
          disconnectSession: undefined,
          getSIDforObject: undefined,
          setSIDforObject: undefined,
          mountedFolderSize: undefined,
          availableDiskSpace: undefined,
        },
        linux: {
          listPath: undefined,
          mountPath: undefined,
          versionDetails: undefined,
          unmountPath: undefined,
          availableDiskSpace: undefined,
          mountedFolderSize: undefined,
        },
        darwin: {
          listPath: undefined,
          mountPath: undefined,
          versionDetails: undefined,
          unmountPath: undefined,
          availableDiskSpace: undefined,
          mountedFolderSize: undefined,
        },
      },
    });
  });

  it('should use environment variables if they are set', () => {
    process.env.NFS_WIN_LIST_PATH_CMD = 'showmount -e ${HOST}';
    process.env.NFS_LINUX_LIST_PATH_CMD = 'showmount -e ${HOST}';
    process.env.NFS_UNIX_LIST_PATH_CMD = 'showmount -e ${HOST}';
    process.env.NFS_LINUX_MOUNT_PATH_CMD = 'mount -t nfs ${HOST}:${MOUNT_PATH} ${DIR_PATH}';
    process.env.SMB_WIN_VALIDATE_CRED_CMD = 'net use \\${HOST} /user:${USERNAME} ${PASSWORD}';
    process.env.SMB_LINUX_LIST_PATH_CMD = 'smbclient -L ${HOST} -U ${USERNAME}%${PASSWORD}';
    process.env.WIN_USED_DISK_SPACE = 'dir /s /b "${MOUNT_PATH}"';

    const config = cmdConfig();
    expect(config).toMatchObject({
      nfs: {
        win32: { listPath: 'showmount -e ${HOST}' },
        linux: { listPath: 'showmount -e ${HOST}', mountPath: 'mount -t nfs ${HOST}:${MOUNT_PATH} ${DIR_PATH}' },
        darwin: { listPath: 'showmount -e ${HOST}' },
      },
      smb: {
        win32: {
          validateCred: 'net use \\${HOST} /user:${USERNAME} ${PASSWORD}',
          mountedFolderSize: 'dir /s /b "${MOUNT_PATH}"',
        },
        linux: { listPath: 'smbclient -L ${HOST} -U ${USERNAME}%${PASSWORD}' },
      },
    });
  });

  it('should handle missing and partially set environment variables', () => {
    clearEnvVars();
    process.env.NFS_WIN_LIST_PATH_CMD = 'showmount -e ${HOST}';

    const config = cmdConfig();
    expect(config).toMatchObject({
      nfs: {
        win32: { listPath: 'showmount -e ${HOST}' },
      },
    });
  });
});

// Static method tests
it('should return undefined for non-existent SMB command', () => {
  const configService = new ConfigService();
  new CommandConfig(configService);
  jest.spyOn(configService, 'get').mockReturnValue(undefined);
  const result = CommandConfig.getSMBCommand('win32', 'nonExistentCommand');
  expect(result).toBeUndefined();
});

it('should return undefined for non-existent NFS command', () => {
  const configService = new ConfigService();
  new CommandConfig(configService);
  jest.spyOn(configService, 'get').mockReturnValue(undefined);
  const result = CommandConfig.getNFSCommand('linux', 'nonExistentCommand');
  expect(result).toBeUndefined();
});

describe('Static Methods', () => {
  beforeEach(() => {
    new CommandConfig(mockConfigService);
  });

  it('should return mounted folder size command for win32 platform', () => {
    mockConfigService.get.mockReturnValue('dir /s /b "${MOUNT_PATH}"');
    const result = CommandConfig.getSMBCommand('win32', 'mountedFolderSize');
    expect(result).toBe('dir /s /b "${MOUNT_PATH}"');
    expect(mockConfigService.get).toHaveBeenCalledWith('cmd.smb.win32.mountedFolderSize');
  });

  it('should return undefined for unset mounted folder size command', () => {
    mockConfigService.get.mockReturnValue(undefined);
    const result = CommandConfig.getSMBCommand('win32', 'mountedFolderSize');
    expect(result).toBeUndefined();
  });

  it('should return correct SMB command for win32 platform', () => {
    mockConfigService.get.mockReturnValue('net use \\${HOST} /user:${USERNAME} ${PASSWORD}');
    const result = CommandConfig.getSMBCommand('win32', 'validateCred');
    expect(result).toBe('net use \\${HOST} /user:${USERNAME} ${PASSWORD}');
  });

  it('should return correct NFS command for linux platform', () => {
    mockConfigService.get.mockReturnValue('showmount -e ${HOST}');
    const result = CommandConfig.getNFSCommand('linux', 'listPath');
    expect(result).toBe('showmount -e ${HOST}');
  });

  it('should return undefined for unset optional NFS command', () => {
    mockConfigService.get.mockReturnValue(undefined);
    const result = CommandConfig.getNFSCommand('darwin', 'unmountPath');
    expect(result).toBeUndefined();
  });
});
