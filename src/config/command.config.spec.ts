import cmdConfig from './command.config';

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
        win: { listPath: undefined },
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
        win: {
          validateCred: undefined,
          listPath: undefined,
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
        win: { listPath: 'showmount -e ${HOST}' },
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
        win: {
          validateCred: 'net use \\\\${HOST} /user:${USERNAME} ${PASSWORD}',
          listPath: undefined,
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
        win: { listPath: 'showmount -e ${HOST}' },
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
        win: {
          validateCred: undefined,
          listPath: undefined,
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
