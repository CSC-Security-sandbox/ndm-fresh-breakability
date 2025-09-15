import { Inject, Injectable, LoggerService } from "@nestjs/common";
import { FileServerDetails } from "@netapp-cloud-datamigrate/jobs-lib";
import { LoggerFactory } from "@netapp-cloud-datamigrate/logger-lib/dist/logger/logger.factory";
import { ShellPoolExecutorService } from "./shell-for-meta-stamping.service";
import * as path from 'path';
import { AclOperations } from "./aclOperations";
import { ParsedACL } from "./aclOperations.types";

@Injectable()
export class SmbUserSetupService {
  private readonly logger: LoggerService;

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private shellPool: ShellPoolExecutorService,
    private aclOperations: AclOperations,
  ) {
    // this.logger = loggerFactory.create(SmbUserSetupService.name);
  }

  async setup(jobRunId: string, context: any): Promise<void> {
    this.logger.debug(`Starting ACL setup for job ${jobRunId}`);
    // Validate input parameters
    if (!context?.jobConfig?.destinationFileServer || !context?.jobConfig?.sourceFileServer) {
      this.logger.error('Invalid context: missing file server configuration');
      throw new Error('Invalid context: missing file server configuration');
    }

    // Step 1: Get ACLs from both source and destination
    const destinationAcl = await this.getFileACL(context.jobConfig.destinationFileServer, jobRunId);
    if (!destinationAcl) {
      this.logger.warn(`No ACL found on destination path ${context.jobConfig.destinationFileServer.path}`);
    }

    const sourceAcl = await this.getFileACL(context.jobConfig.sourceFileServer, jobRunId);
    if (!sourceAcl) {
      this.logger.warn(`No ACL found on source path ${context.jobConfig.sourceFileServer.path}`);
    }

    // Step 2: Add source principals to destination
    if (sourceAcl?.permissions && sourceAcl.permissions.length > 0) {
      this.logger.log(`Processing ${sourceAcl.permissions.length} principals from source`);
      
      for (const entry of sourceAcl.permissions) {
        const principal = this.normalizePrincipal(entry.principal);
        const permissions = this.formatPermissions(entry.permissions);
        
        if (!permissions) {
          this.logger.debug(`Skipping principal ${principal} - no valid permissions`);
          continue;
        }

        try {
          this.logger.debug(`Adding principal ${principal} with permissions ${permissions}`);
          await this.addPrincipals(context.jobConfig.destinationFileServer, principal, permissions, context.jobRunId);
        } catch (error) {
          this.logger.error(`Error adding principal ${principal} to destination ACL: ${error.message}`, error.stack);
        }
      }
    } else {
      this.logger.log('No principals found in source ACL to add');
    }

    // Step 3: Remove principals from destination that are not in source
    const destAvailablePrincipals = destinationAcl?.permissions?.map(entry => this.normalizePrincipal(entry.principal)) || [];
    const sourceAvailablePrincipals = sourceAcl?.permissions?.map(entry => this.normalizePrincipal(entry.principal)) || [];
    
    const usersToRemoveSet = new Set(destAvailablePrincipals.filter(principal => !sourceAvailablePrincipals.includes(principal)));
    const usersToRemove = Array.from(usersToRemoveSet);
    
    if (usersToRemove.length > 0) {
      this.logger.log(`Removing ${usersToRemove.length} principals from destination: ${usersToRemove.join(', ')}`);
      
      for (const user of usersToRemove) {
        try {
          await this.removePrincipals(context.jobConfig.destinationFileServer, user);
        } catch (error) {
          this.logger.error(`Error removing principal ${user} from destination: ${error.message}`, error.stack);
        }
      }
    } else {
      this.logger.debug('No principals to remove from destination');
    }

    this.logger.log(`ACL setup completed for job ${jobRunId}`);
  }

  private normalizePrincipal(principal: string): string {
    if (!principal) {
      return '';
    }
    // Don't lowercase SIDs (they start with S-)
    return principal.startsWith("S-") ? principal : principal.toLowerCase();
  }

  private formatPermissions(permissions: any[]): string {
    if (!permissions || permissions.length === 0) {
      return '';
    }
    
    const filtered = permissions
      .filter(p => p?.code && p.code.toUpperCase() !== 'I')
      .map(p => `(${p.code})`)
      .join('');
      
    return filtered || '';
  }

  async removePrincipals(destinationPath: FileServerDetails, principal: string): Promise<void> {
    if (!destinationPath || !principal) {
      throw new Error('Invalid parameters: destinationPath and principal are required');
    }

    const filePath = "\\\\" + path.join(destinationPath.hostname, destinationPath.path);
    const command = `icacls "${filePath}" /remove "${principal}"`;
    
    this.logger.debug(`Executing command: ${command}`);
    
    try {
      const { stdout, stderr } = await this.shellPool.executeCommand(command);
      if (stderr) {
        this.logger.error(`Error removing principal ${principal} from ${destinationPath.path}: ${stderr}`);
        throw new Error(stderr);
      }
      this.logger.log(`Successfully removed principal ${principal} from ${destinationPath.path}`);
      this.logger.debug(`Command output: ${stdout}`);
    } catch (error) {
      this.logger.error(`Failed to remove principal ${principal} from ${destinationPath.path}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async addPrincipals(destinationPath: FileServerDetails, principal: string, permission: string, jobRunId?: string): Promise<void> {
    if (!destinationPath || !principal || !permission) {
      throw new Error('Invalid parameters: destinationPath, principal, and permission are required');
    }

    const filePath = "\\\\" + path.join(destinationPath.hostname, destinationPath.path);
    
    try {
      let resolvedPrincipal = principal;
      if (jobRunId) {
        this.logger.debug(`Resolving principal ${principal} for job ${jobRunId}`);
        resolvedPrincipal = await this.aclOperations.resolvePrincipal(principal, jobRunId);
      }
      
      const command = `icacls "${filePath}" /grant "${resolvedPrincipal}:${permission}"`;
      this.logger.debug(`Executing command: ${command}`);
      
      const { stdout, stderr } = await this.shellPool.executeCommand(command);
      if (stderr) {
        this.logger.error(`Error adding principal ${resolvedPrincipal} to ${destinationPath.path}: ${stderr}`);
        throw new Error(stderr);
      }
      
      this.logger.log(`Successfully added principal ${resolvedPrincipal} with permission ${permission} to ${destinationPath.path}`);
      this.logger.debug(`Command output: ${stdout}`);
    } catch (error) {
      this.logger.error(`Failed to add principal ${principal} to ${destinationPath.path}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getFileACL(fileServer: FileServerDetails, jobRunId: string): Promise<ParsedACL | null> {
    if (!fileServer) {
      this.logger.error('Invalid fileServer parameter');
      return null;
    }

    const filePath = "\\\\" + path.join(fileServer.hostname, fileServer.path);
    const command = `icacls "${filePath}" /L`;
    
    try {
      this.logger.debug(`Getting ACL for ${filePath}`);
      const { stdout, stderr } = await this.shellPool.executeCommand(command);
      
      if (stderr) {
        this.logger.warn(`Error getting ACL for ${filePath}: ${stderr}`);
        return null;
      }
      
      this.logger.debug(`Raw ACL output for ${filePath}: ${stdout}`);

      const parsedAcl: ParsedACL = this.aclOperations.parseIcaclsOutput(stdout, filePath);
      
      if (!parsedAcl || parsedAcl.permissions.length === 0) {
        this.logger.warn(`No ACL permissions found for ${filePath}`);
        return null;
      }
      
      this.logger.debug(`Parsed ACL for ${filePath}: ${JSON.stringify(parsedAcl)}`);
      return parsedAcl;
    } catch (error) {
      this.logger.error(`Failed to get ACL for ${filePath}: ${error.message}`, error.stack);
      throw error;
    }
  }
}
