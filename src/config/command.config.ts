import { registerAs } from '@nestjs/config';


// @types 
export interface Commands{
    nfs : NFSCommands,
    smb: SMBCommands,
    common: CommandCommands
}

export interface NFSCommands{
    win: {
        listPath?: string | undefined
        mountPath?: string | undefined
        checkMountPath?: string | undefined
    },
    linux: {
        listPath?: string | undefined
        mountPath?: string | undefined
        checkMountPath?: string | undefined
    },
    unix: {
        listPath?: string | undefined
        mountPath?: string | undefined
        checkMountPath?: string | undefined
    }
}

export interface SMBCommands{
    win: {
        validateCred: string | undefined
        listPath?: string | undefined
        mountPath?: string | undefined
    },
    linux: {
        listPath?: string | undefined
        mountPath?: string | undefined

    },
    unix: {
        listPath?: string | undefined
        mountPath?: string | undefined
    }
}

export interface CommandCommands {
    win: {
        unmountPath?: string | undefined
    },
    linux: {
        unmountPath?: string | undefined,
        isPathExist?: string | undefined
    },
    unix: {
        unmountPath?: string | undefined,
        isPathExist?: string | undefined
    }
}

// @register env
export default registerAs(
    'cmd',
    ():Commands => ({
        nfs: {
            win: {
                listPath: process.env.NFS_LIST_PATH_CMD,
            },
            linux: {
                listPath: process.env.NFS_LINUX_LIST_PATH_CMD,
                mountPath:  process.env.NFS_LINUX_MOUNT_PATH_CMD,
                checkMountPath: process.env.NFS_LINUX_CHECK_MOUNT_PATH_CMD,
            },
            unix: {
                listPath: process.env.NFS_UNIX_LIST_PATH_CMD,
                mountPath:  process.env.NFS_UNIX_MOUNT_PATH_CMD,
                checkMountPath: process.env.NFS_UNIX_CHECK_MOUNT_PATH_CMD,
            },
        },
        smb: {
            win: {
                validateCred: process.env.SMB_WIN_VALIDATE_CRED_CMD,
                listPath: process.env.SMB_WIN_LIST_PATH_CMD,
            },
            linux: {
                listPath: process.env.SMB_LINUX_LIST_PATH_CMD,
                mountPath:  process.env.SMB_LINUX_MOUNT_PATH_CMD,
            },
            unix: {
                listPath: process.env.SMB_UNIX_LIST_PATH_CMD,
                mountPath:  process.env.SMB_UNIX_MOUNT_PATH_CMD,

            },
        },
        common: {
            win: {
                unmountPath: process.env.WIN_UNMOUNT_PATH_CMD,
            },
            linux: {
                unmountPath: process.env.LINUX_UNMOUNT_PATH_CMD,
                isPathExist: process.env.LINUX_CHECK_PATH_ISMOUNTED,
            },
            unix: {
                unmountPath: process.env.UNIX_UNMOUNT_PATH_CMD,
                isPathExist: process.env.UNIX_CHECK_PATH_ISMOUNTED,
            }
        }
    })
)