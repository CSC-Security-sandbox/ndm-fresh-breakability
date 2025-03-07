import { Injectable } from '@nestjs/common';
import { ConfigService, registerAs } from '@nestjs/config';


export enum CommandPattern{
    VALIDATE_CRED='validateCred',
    LIST_PATHS='listPath',
    CREATE_PATH_LINK = 'linkPath',
    CHECK_MOUNT_PATH='checkMountPath',
    UNMOUNT_PATH='unmountPath',
    MOUNT_PATH='mountPath',
    VERSION_DETAIL='versionDetails',
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
            },
            linux: {
                listPath: process.env.NFS_LINUX_LIST_PATH_CMD,
                mountPath:  process.env.NFS_LINUX_MOUNT_PATH_CMD,
                checkMountPath: process.env.NFS_LINUX_CHECK_MOUNT_PATH_CMD,
                versionDetails: process.env.NFS_LINUX_VERSION_DETAIL_CMD,
                unmountPath:  process.env.NFS_LINUX_UNMOUNT_PATH_CMD,
            },
            darwin: {
                listPath: process.env.NFS_UNIX_LIST_PATH_CMD,
                mountPath:  process.env.NFS_UNIX_MOUNT_PATH_CMD,
                checkMountPath: process.env.NFS_UNIX_CHECK_MOUNT_PATH_CMD,
                versionDetails: process.env.NFS_UNIX_VERSION_DETAIL_CMD,
                unmountPath:  process.env.NFS_UNIX_UNMOUNT_PATH_CMD,
            },
        },
        smb: {
            win32: {
                validateCred: process.env.SMB_WIN_VALIDATE_CRED_CMD,
                listPath: process.env.SMB_WIN_LIST_PATH_CMD,
                mountPath:  process.env.SMB_WIN_MOUNT_PATH_CMD,
                versionDetails: process.env.SMB_WIN_VERSION_DETAIL_CMD,
                unmountPath:  process.env.SMB_WIN_UNMOUNT_PATH_CMD,
                linkPath: process.env.SMB_WIN_CREATE_LINK_CMD,
            },
            linux: {
                listPath: process.env.SMB_LINUX_LIST_PATH_CMD,
                mountPath:  process.env.SMB_LINUX_MOUNT_PATH_CMD,
                versionDetails: process.env.SMB_LINUX_VERSION_DETAIL_CMD,
                unmountPath:  process.env.SMB_LINUX_UNMOUNT_PATH_CMD,
            },
            darwin: {
                listPath: process.env.SMB_UNIX_LIST_PATH_CMD,
                mountPath:  process.env.SMB_UNIX_MOUNT_PATH_CMD,
                unmountPath:  process.env.SMB_UNIX_UNMOUNT_PATH_CMD,
                versionDetails: process.env.NFS_UNIX_VERSION_DETAIL_CMD
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
}