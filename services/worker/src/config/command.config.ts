import { Injectable } from '@nestjs/common';
import { ConfigService, registerAs } from '@nestjs/config';


export enum CommandPattern{
    VALIDATE_CRED='validateCred',
    LIST_PATHS='listPath',
    CREATE_PATH_LINK = 'linkPath',
    CHECK_MOUNT_PATH='checkMountPath',
    UNMOUNT_PATH='unmountPath',
    MOUNT_PATH='mountPath',
    UNLINK_PATH='unlinkPath',
    VERSION_DETAIL='versionDetails',
    DISCONNECT_SESSION='disconnectSession',
    GET_SID_FOR_OBJECT='getSIDforObject',
    SET_SID_FOR_OBJECT='setSIDforObject',
    SET_SID_FOR_OBJECT_DIR='setSIDforDirObject',
    MOUNTED_FOLDER_SIZE='mountedFolderSize',
    AVAILABLE_DISK_SPACE='availableDiskSpace',
    FSTAB_PATH='fstabPath',
    SAVE_CREDS='saveCreds'
}

// @types 
export interface Commands{
    nfs : ProtocolCommands,
    smb: ProtocolCommands,
}

export interface ProtocolCommands{
    win32: BaseCommands,
    linux: BaseCommands,
    darwin: BaseCommands
}

export interface BaseCommands {
    validateCred?: string | undefined
    listPath?: string | undefined
    mountPath?: string | undefined
    checkMountPath?: string | undefined
    unmountPath?: string | undefined
    versionDetails?: string | undefined;
    linkPath?: string | undefined
    unlinkPath?: string | undefined
    disconnectSession?: string | undefined
    getSIDforObject? : string | undefined
    setSIDforDirObject? : string | undefined
    setSIDforObject?: string | undefined
    mountedFolderSize? : string | undefined
    availableDiskSpace? : string | undefined
    fstabPath? : string | undefined
    saveCreds? : string | undefined
}

export default registerAs(
    'cmd',
    ():Commands => ({
        nfs: {
            win32: {
                listPath: process.env.NFS_WIN_LIST_PATH_CMD,
                versionDetails: process.env.NFS_WIN_VERSION_DETAIL_CMD,
                mountPath:  process.env.NFS_WIN_MOUNT_PATH_CMD,
                unmountPath:  process.env.NFS_WIN_UNMOUNT_PATH_CMD,
                availableDiskSpace: process.env.WIN_AVAILABLE_DISK_SPACE_CMD,
                mountedFolderSize: process.env.WIN_USED_DISK_SPACE
            },
            linux: {
                listPath: process.env.NFS_LINUX_LIST_PATH_CMD,
                mountPath:  process.env.NFS_LINUX_MOUNT_PATH_CMD,
                checkMountPath: process.env.NFS_LINUX_CHECK_MOUNT_PATH_CMD,
                versionDetails: process.env.NFS_LINUX_VERSION_DETAIL_CMD,
                unmountPath:  process.env.NFS_LINUX_UNMOUNT_PATH_CMD,
                availableDiskSpace: process.env.LINUX_AVAILABLE_DISK_SPACE_CMD,
                mountedFolderSize: process.env.LINUX_USED_DISK_SPACE,
                fstabPath: process.env.LINUX_FSTAB_PATH
            },
            darwin: {
                listPath: process.env.NFS_UNIX_LIST_PATH_CMD,
                mountPath:  process.env.NFS_UNIX_MOUNT_PATH_CMD,
                checkMountPath: process.env.NFS_UNIX_CHECK_MOUNT_PATH_CMD,
                versionDetails: process.env.NFS_UNIX_VERSION_DETAIL_CMD,
                unmountPath:  process.env.NFS_UNIX_UNMOUNT_PATH_CMD,
                availableDiskSpace: process.env.UNIX_AVAILABLE_DISK_SPACE_CMD,
                mountedFolderSize: process.env.UNIX_USED_DISK_SPACE,
                fstabPath: process.env.UNIX_FSTAB_PATH
            },
        },
        smb: {
            win32: {
                validateCred: process.env.SMB_WIN_VALIDATE_CRED_CMD,
                listPath: process.env.SMB_WIN_LIST_PATH_CMD,
                mountPath:  process.env.SMB_WIN_MOUNT_PATH_CMD,
                versionDetails: process.env.SMB_WIN_VERSION_DETAIL_CMD,
                unmountPath:  process.env.SMB_WIN_UNMOUNT_PATH_CMD,
                linkPath: process.env.SMB_WIN_CREATE_LINK_PATH_CMD,
                unlinkPath: process.env.SMB_WIN_UNLINK_PATH_CMD,
                disconnectSession: process.env.SMB_WIN_DISCONNECT_SESSION_CMD,
                getSIDforObject: process.env.SMB_WIN_GET_SID_FOR_OBJECT_CMD,
                setSIDforDirObject: process.env.SMB_WIN_SET_SID_FOR_DIR_OBJECT_CMD,
                mountedFolderSize: process.env.WIN_USED_DISK_SPACE,
                availableDiskSpace: process.env.WIN_AVAILABLE_DISK_SPACE_CMD,
                saveCreds: process.env.SMB_WIN_SAVE_CREDS
            },
            linux: {
                listPath: process.env.SMB_LINUX_LIST_PATH_CMD,
                mountPath:  process.env.SMB_LINUX_MOUNT_PATH_CMD,
                versionDetails: process.env.SMB_LINUX_VERSION_DETAIL_CMD,
                unmountPath:  process.env.SMB_LINUX_UNMOUNT_PATH_CMD,
                availableDiskSpace: process.env.LINUX_AVAILABLE_DISK_SPACE_CMD,
                mountedFolderSize: process.env.LINUX_USED_DISK_SPACE,saveCreds: process.env.LINUX_SAVE_CREDS_CMD
            },
            darwin: {
                listPath: process.env.SMB_UNIX_LIST_PATH_CMD,
                mountPath:  process.env.SMB_UNIX_MOUNT_PATH_CMD,
                unmountPath:  process.env.SMB_UNIX_UNMOUNT_PATH_CMD,
                versionDetails: process.env.NFS_UNIX_VERSION_DETAIL_CMD,
                availableDiskSpace: process.env.UNIX_AVAILABLE_DISK_SPACE_CMD,
                mountedFolderSize: process.env.UNIX_USED_DISK_SPACE
            },
        }
    })
)

@Injectable()
export class CommandConfig {
  static configService: ConfigService;

  constructor(configService: ConfigService) {
    CommandConfig.configService = configService;
  }

  static getSMBCommand(platform: NodeJS.Platform, key: string): any {
    return CommandConfig.configService.get(`cmd.smb.${platform}.${key}`);
  }

  static getNFSCommand(platform: NodeJS.Platform, key: string): any {
    return CommandConfig.configService.get(`cmd.nfs.${platform}.${key}`);
  }

  static getFstabPath(platform: NodeJS.Platform, fstabPath: string): any {
    return CommandConfig.configService.get(`cmd.nfs.${platform}.${fstabPath}`);
  }
}
