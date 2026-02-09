import { Injectable, Inject } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { RedisService } from 'src/redis/redis.service';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

const execAsync = promisify(exec);

export interface MountInput {
  fileServerId: string;
  hostname: string;
  exportPath: string;
  protocol: string;
  username?: string;
  password?: string;
  protocolVersion?: string;
}

export interface ListDirsInput {
  mountPath: string;
  path: string;
}

export interface StoreResultInput {
  key: string;
  result: any;
}

@Injectable()
export class ListDirsActivity {
  private readonly logger: LoggerService;

  constructor(
    private readonly redisService: RedisService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(ListDirsActivity.name);
  }

  async mountExportPath(input: MountInput): Promise<string> {
    const mountDir = `/mnt/nfs/${input.fileServerId}`;

    this.logger.log(`Mounting ${input.hostname}:${input.exportPath} to ${mountDir}`);

    // Create mount directory
    await fs.promises.mkdir(mountDir, { recursive: true });

    // Build mount command based on protocol
    let mountCmd: string;
    if (input.protocol === 'NFS') {
      const version = input.protocolVersion?.replace('v', '') || '4';
      mountCmd = `mount -t nfs -o vers=${version},nolock ${input.hostname}:${input.exportPath} ${mountDir}`;
    } else if (input.protocol === 'SMB') {
      const exportPath = input.exportPath.replace(/\\/g, '/');
      const credentials = input.username
        ? `username=${input.username},password=${input.password}`
        : 'guest';
      mountCmd = `mount -t cifs //${input.hostname}${exportPath} ${mountDir} -o ${credentials},vers=3.0`;
    } else {
      throw new Error(`Unsupported protocol: ${input.protocol}`);
    }

    await execAsync(mountCmd);
    this.logger.log(`Successfully mounted to ${mountDir}`);

    return mountDir;
  }

  async listDirectories(input: ListDirsInput): Promise<{name : string}[]> {
    const fullPath = `${input.mountPath}/${input.path}`.replace(/\/+/g, '/');

    this.logger.log(`Listing directories in ${fullPath}`);

    try {
      // Use ls -1F to append / to directories
    // const { stdout } = await execAsync(`ls -F "${fullPath}" 2>/dev/null`);
    //   const { stdout } = await execAsync(`tree -d --noreport -i -J -L 2 "${fullPath}" 2>/dev/null`);
    const { stdout } = await execAsync(`find "${fullPath}" -maxdepth 2 -type d 2>/dev/null`, { maxBuffer: 1024 * 1024 * 10 });
    
    const normalizedFullPath = fullPath.replace(/\/$/, ''); 
    const directories = stdout.trim().split('\n')
    .filter(entry => {
        const normalizedEntry = entry.replace(/\/$/, '');
        return entry.length > 0 && normalizedEntry !== normalizedFullPath;
    })
    .map(entry => {
        let name = entry.replace(fullPath, '').replace(/^\//, '');
        if (name === entry) {
        name = entry.replace(normalizedFullPath, '').replace(/^\//, '');
        }
        return { name };
    });
    
    this.logger.log(`Found ${directories.length} directories`);
    return directories;
    } catch (error) {
      if (error.code === 1 || error.stderr?.includes('No such file')) {
        return []; // Empty or doesn't exist
      }
      throw error;
    }
  }

  async unmountExportPath(mountPath: string): Promise<void> {
    this.logger.log(`Unmounting ${mountPath}`);

    try {
      await execAsync(`umount ${mountPath}`);
      await fs.promises.rmdir(mountPath);
      this.logger.log(`Successfully unmounted ${mountPath}`);
    } catch (error) {
      this.logger.error(`Error unmounting: ${error.message}`);
      throw error;
    }
  }

  async storeResultInRedis(input: StoreResultInput): Promise<void> {
    this.logger.log(`Storing result in Redis with key: ${input.key}`);
    await this.redisService.setDirListing(input.key, JSON.stringify(input.result), 60);
  }
}