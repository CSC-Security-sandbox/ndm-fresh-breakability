import { Injectable } from '@nestjs/common';
import { ConfigObject, ConfigService, registerAs } from '@nestjs/config';

export default registerAs(
  'worker',
  (): ConfigObject => ({
    shutdownTimeout: process.env.SHUTDOWN_TIMEOUT || 5000,
    workerShutdownTimeout: process.env.WORKER_SHUTDOWN_TIMEOUT || 5000,
    workerId: process.env.WORKER_ID || '6cf21220-5627-4614-a947-778915dba29f',
    buildId: process.env.BUILD_ID || '1.0.0',
    workerConfigUrl:
      process.env.WORKER_CONFIG_URL ||
      'http://localhost:3004/api/v1/work-manager/',
    workerJobServiceUrl:
      process.env.WORKER_JOB_SERVICE_URL ||
      'http://localhost:3001/api/v1/job-run',
    platform: process.platform,
    baseMountDir: process.env.BASE_MOUNT_DIR || '/Users/avadoot.narvekar/code_base/netapp/netapp_code_base/mount1',
    workerName: process.env.WORKER_NAME || 'worker',
    projectId: process.env.PROJECT_ID || 'cb6cbe71-676b-4fcc-913e-f30610c8b755',
    smbValidateCommand:
      process.env.SMB_VALIDATE_CONNECTION_COMMAND ||
      'smbutil view //${username}:${password}@${hostname}',
    nfsValidateCommand:
      process.env.NFS_VALIDATE_CONNECTION_COMMAND || 'showmount -e ${hostname}',
    nfsShowmountCommand:
      process.env.NFS_SHOWMOUNT_COMMAND || 'showmount -e ${hostname}',
    smbShowsharesCommand:
      process.env.SMB_SHOWSHARES_COMMAND ||
      'smbutil view //${username}:${password}@${hostname}',
    nfsGetProtocolsCommand:
      process.env.NFS_GET_PROTOCOLS_COMMAND ||
      'rpcinfo -p ${hostname} |grep nfs',
    smbGetProtocolsCommand:
      process.env.SMB_GET_PROTOCOLS_COMMAND ||
      'nmap -p 445 --script smb-protocols ${hostname}',
    nfsMountCommand:
      process.env.NFS_MOUNT_COMMAND ||
      'mount -t nfs -o resvport ${HOST}:${PATH} ${BASE_DIR}/${JOB_RUN_ID}/${PATH_ID}',
    smbMountCommand:
      process.env.SMB_MOUNT_COMMAND ||
      'mount -t cifs //${hostname}/${path} ${baseMountDir}/${jobRunId} -o username=${username},password=${password}',
    nfsUnmountCommand:
      process.env.NFS_UNMOUNT_COMMAND || 'umount ${BASE_DIR}/${JOB_RUN_ID}/${PATH_ID}',
    smbUnmountCommand:
      process.env.SMB_UNMOUNT_COMMAND || 'umount ${baseMountDir}/${jobRunId}',
    baseDirectoryToValidateWorkingDirectory:
      process.env.BASE_DIR_TO_VALIDATE_WORKING_DIRECTORY  
  }),
);

@Injectable()
export class WorkersConfig {
  static configService: ConfigService;

  constructor(configService: ConfigService) {
    WorkersConfig.configService = configService;
  }

  static get(key: string): any {
    return WorkersConfig.configService.get(`worker.${key}`);
  }
}
