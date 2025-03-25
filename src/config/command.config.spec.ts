import { ConfigService } from '@nestjs/config';
import cmdConfig, { CommandConfig } from './command.config';

describe('Command Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
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
  };

  it('should return default values when no environment variables are set', () => {
    clearEnvVars();
    const config = cmdConfig();
    expect(config).toEqual({
      nfs: {
        win32: {
          listPath: undefined,
          mountPath: undefined,
          unmountPath: undefined,
          versionDetails: undefined,
        },
        linux: {
          listPath: undefined,
          mountPath: undefined,
          checkMountPath: undefined,
        },
        darwin: {
          listPath: undefined,
          mountPath: undefined,
          checkMountPath: undefined,
        },
      },
      smb: {
        win32: {
          validateCred: undefined,
          listPath: undefined,
          mountPath: undefined,
          serSIDforObject: undefined,
          unlinkPath: undefined,
          unmountPath: undefined,
          versionDetails: undefined,
          disconnectSession: undefined,
          getSIDforObject: undefined,
          linkPath: undefined,
        },
        linux: {
          listPath: undefined,
          mountPath: undefined,
        },
        darwin: {
          listPath: undefined,
          mountPath: undefined,
        },
      },
    });
  });

  it('should use environment variables if they are set', () => {
    process.env.NFS_WIN_LIST_PATH_CMD = 'showmount -e ${HOST}';
    process.env.NFS_LINUX_LIST_PATH_CMD = 'showmount -e ${HOST}';
    process.env.NFS_UNIX_LIST_PATH_CMD = 'showmount -e ${HOST}';
    process.env.NFS_LINUX_MOUNT_PATH_CMD = 'mount -t nfs ${HOST}:${MOUNT_PATH} ${DIR_PATH}';
    process.env.SMB_WIN_VALIDATE_CRED_CMD = 'net use \\\\${HOST} /user:${USERNAME} ${PASSWORD}';
    process.env.SMB_LINUX_LIST_PATH_CMD = 'smbclient -L ${HOST} -U ${USERNAME}%${PASSWORD}';

    const config = cmdConfig();
    expect(config).toEqual({
      nfs: {
        win32: {
          listPath: 'showmount -e ${HOST}',
          mountPath: undefined,
          unmountPath: undefined,
          versionDetails: undefined,
        },
        linux: {
          listPath: 'showmount -e ${HOST}',
          mountPath: 'mount -t nfs ${HOST}:${MOUNT_PATH} ${DIR_PATH}',
          checkMountPath: undefined,
        },
        darwin: {
          listPath: 'showmount -e ${HOST}',
          mountPath: undefined,
          checkMountPath: undefined,
        },
      },
      smb: {
        win32: {
          disconnectSession: undefined,
          getSIDforObject: undefined,
          linkPath: undefined,
          listPath: undefined,
          mountPath: undefined,
          serSIDforObject: undefined,
          unlinkPath: undefined,
          unmountPath: undefined,
          validateCred: 'net use \\\\${HOST} /user:${USERNAME} ${PASSWORD}',
          versionDetails: undefined,
        },
        linux: {
          listPath: 'smbclient -L ${HOST} -U ${USERNAME}%${PASSWORD}',
          mountPath: undefined,
        },
        darwin: {
          listPath: undefined,
          mountPath: undefined,
        },
      },
    });
  });

  it('should handle missing and partially set environment variables', () => {
    clearEnvVars();
    process.env.NFS_WIN_LIST_PATH_CMD = 'showmount -e ${HOST}';

    const config = cmdConfig();
    expect(config).toEqual({
      nfs: {
        win32: {
          listPath: 'showmount -e ${HOST}',
          mountPath: undefined,
          unmountPath: undefined,
          versionDetails: undefined,
        },
        linux: {
          listPath: undefined,
          mountPath: undefined,
          checkMountPath: undefined,
        },
        darwin: {
          listPath: undefined,
          mountPath: undefined,
          checkMountPath: undefined,
        },
      },
      smb: {
        win32: {
          validateCred: undefined,
          listPath: undefined,
          mountPath: undefined,
          serSIDforObject: undefined,
          unlinkPath: undefined,
          unmountPath: undefined,
          versionDetails: undefined,
          disconnectSession: undefined,
          getSIDforObject: undefined,
          linkPath: undefined,
        },
        linux: {
          listPath: undefined,
          mountPath: undefined,
        },
        darwin: {
          listPath: undefined,
          mountPath: undefined,
        },
      },
    });
  });
});

it('should return undefined for non-existent SMB command', () => {
    const configService = new ConfigService();
    const commandConfig = new CommandConfig(configService);
    jest.spyOn(configService, 'get').mockReturnValue(undefined);

    const result = CommandConfig.getSMBCommand('win32', 'nonExistentCommand');
    expect(result).toBeUndefined();
});

it('should return undefined for non-existent NFS command', () => {
    const configService = new ConfigService();
    const commandConfig = new CommandConfig(configService);
    jest.spyOn(configService, 'get').mockReturnValue(undefined);

    const result = CommandConfig.getNFSCommand('linux', 'nonExistentCommand');
    expect(result).toBeUndefined();
});

it('should return correct SMB command for win32 platform', () => {
    const configService = new ConfigService();
    const commandConfig = new CommandConfig(configService);
    jest.spyOn(configService, 'get').mockReturnValue('net use \\\\${HOST} /user:${USERNAME} ${PASSWORD}');

    const result = CommandConfig.getSMBCommand('win32', 'validateCred');
    expect(result).toBe('net use \\\\${HOST} /user:${USERNAME} ${PASSWORD}');
});

it('should return correct NFS command for linux platform', () => {
    const configService = new ConfigService();
    const commandConfig = new CommandConfig(configService);
    jest.spyOn(configService, 'get').mockReturnValue('showmount -e ${HOST}');

    const result = CommandConfig.getNFSCommand('linux', 'listPath');
    expect(result).toBe('showmount -e ${HOST}');
});

it('should return undefined for unset optional commands', () => {
    const configService = new ConfigService();
    const commandConfig = new CommandConfig(configService);
    jest.spyOn(configService, 'get').mockReturnValue(undefined);

    const result = CommandConfig.getNFSCommand('darwin', 'unmountPath');
    expect(result).toBeUndefined();
});
