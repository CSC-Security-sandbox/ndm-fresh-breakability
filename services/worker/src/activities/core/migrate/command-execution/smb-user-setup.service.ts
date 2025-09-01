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
    this.logger = loggerFactory.create(SmbUserSetupService.name);
  }

  async setup(jobRunId: string, context: any): Promise<void> {
    // Step 1: List down all ACLs in source
    const destinationAcl = await this.getFileACL(context.jobConfig.destinationFileServer, jobRunId);
    if (!destinationAcl) {
      this.logger.warn(`No ACL found on destination path ${context.jobConfig.destinationFileServer.path}`);
      
    }

    const sourceAcl = await this.getFileACL(context.jobConfig.sourceFileServer, jobRunId);
    if (!sourceAcl) {
      this.logger.warn(`No ACL found on source path ${context.jobConfig.sourceFileServer.path}`);
     
    }

    // Step 2: Add destination user as ACL entry
    this.logger.debug(`Source ACL: ${JSON.stringify(destinationAcl)}`);
    const destAvailablePrincipals = destinationAcl?.permissions?.map(entry => entry.principal.toLowerCase()) || [];
    this.logger.debug(`Available principals on destination: ${JSON.stringify(destAvailablePrincipals)}`);
    const stampCurrentUser = destAvailablePrincipals.includes(context.jobConfig.destinationFileServer.username.toLowerCase());
    if (!stampCurrentUser) {
      try {
        await this.addPrincipals(context.jobConfig.destinationFileServer, context.jobConfig.destinationFileServer.username,"(OI)(CI)(F)");
      } catch (error) {
        this.logger.error(`Error adding destination user ${context.jobConfig.destinationFileServer.username} to ACL`, error);
      }
    }

    // Step 3: Remove all other users in destination
    const usersToRemove = destAvailablePrincipals.filter(principal => principal !== context.jobConfig.destinationFileServer.username.toLowerCase());
    if (usersToRemove.length > 0) {
      try {
        for (const user of usersToRemove) {
          await this.removePrincipals(context.jobConfig.destinationFileServer, user);
          this.logger.debug(`Removed principal ${user} from destination ACL`);
        }
      } catch (error) {
        this.logger.error(`Error removing principals from ${context.jobConfig.destinationFileServer}`, error);
      }
    }

    // Step 4: Disable inheritance
    try {
      await this.disableInheritance(context.jobConfig.destinationFileServer);
    } catch (error) {
      this.logger.error(`Error disabling inheritance on ${context.jobConfig.destinationFileServer.path}`, error);
    }

    // Step 5: Add all source users to destination
    for (const entry of sourceAcl.permissions) {
      const principal = entry.principal.toLowerCase();
      const permissions = entry.permissions.map(p => `(${p.code})`).join('');
        try {
          await this.addPrincipals(context.jobConfig.destinationFileServer, principal, permissions, context.jobRunId);
        } catch (error) {
          this.logger.error(`Error adding principal ${principal} to destination ACL`, error);
        }
      
    }
  }

  async disableInheritance(destinationPath: FileServerDetails): Promise<void> {
    const filePath = "\\\\" + path.join( destinationPath.hostname, destinationPath.path);
    const command = `icacls "${filePath}" /inheritance:d`;
    try {
      await this.shellPool.executeCommand(command);
      this.logger.debug(`Successfully disabled inheritance on ${destinationPath.path}`);
    } catch (error) {
      this.logger.error(`Error disabling inheritance on ${destinationPath.path}`, error);
      throw error;
    }
  }

  async removePrincipals(destinationPath: FileServerDetails, principal: string): Promise<void> {
    const filePath = "\\\\" + path.join( destinationPath.hostname, destinationPath.path);
    const command = `icacls "${filePath}" /remove "${principal}"`;
    try {
      await this.shellPool.executeCommand(command);
      this.logger.debug(`Successfully removed principal ${principal} from ${destinationPath.path}`);
    } catch (error) {
      this.logger.error(`Error removing principal ${principal} from ${destinationPath.path}`, error);
      throw error;
    }
  }

  async addPrincipals(destinationPath: FileServerDetails, principal: string, permission: string, jobRunId?: string): Promise<void> {
    const filePath = "\\\\" + path.join( destinationPath.hostname, destinationPath.path);
   try {
        if (jobRunId) {
           principal = await this.aclOperations.resolvePrincipal(principal, jobRunId);
       }
       const command = `icacls "${filePath}" /grant "${principal}:${permission}"`;
       this.logger.debug(`Executing command ->: ${command}`);
       await this.shellPool.executeCommand(command);
       this.logger.debug(`Successfully added principal ${principal} with permission ${permission} to ${destinationPath.path}`);
    } catch (error) {
      this.logger.error(`Error adding principal ${principal} to ${destinationPath.path}`, error);
      throw error;
    }
  }

  async getFileACL(fileServer: FileServerDetails, jobRunId: string): Promise<ParsedACL | null> {
    const filePath = "\\\\" + path.join( fileServer.hostname, fileServer.path);
    const command = `icacls "${filePath}" /L`;
    try {
        this.logger.debug(`Getting ACL for file ${filePath} using command: ${command}`);
      const { stdout, stderr } = await this.shellPool.executeCommand(command);
      if (stderr) {
        this.logger.error(`Error getting ACL for file ${filePath}: ${stderr}`);
        return null;
      }
      this.logger.debug(`ACL for file ${filePath}: ${stdout}`);

      const parsedAcl: ParsedACL = this.aclOperations.parseIcaclsOutput(stdout, filePath);
      this.logger.debug(`Parsed ACL for file ${filePath}: ${JSON.stringify(parsedAcl)}`);

      if (parsedAcl.permissions.length === 0) {
        this.logger.warn(`No ACL permissions found for file ${filePath}`);
        return null;
      }
      return parsedAcl;
    } catch (error) {
      this.logger.error(`Error getting ACL for file ${filePath}`, error);
      throw error;
    }
  }
}
