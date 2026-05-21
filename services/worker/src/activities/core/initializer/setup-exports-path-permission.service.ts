import { Inject, Injectable, LoggerService } from "@nestjs/common";
import { FileServerDetails } from "@netapp-cloud-datamigrate/jobs-lib";
import { JobManagerContext } from "@netapp-cloud-datamigrate/jobs-lib/dist/types/job-manager-context/job-manager-context";
import { LoggerFactory } from "@netapp-cloud-datamigrate/logger-lib";
import * as path from 'path';
import { WinShellService } from "src/activities/common/win-shell.service";
import { basePrefix } from "src/activities/utils/utils";
import { ProtocolTypes } from "src/protocols/protocols";
import { RedisService } from "src/redis/redis.service";

interface Permission {
    code: string;
    description: string;
}

interface ACLEntry {
    principal: string;
    originalPrincipal?: string;
    permissions: Permission[];
    accessType: 'allow' | 'deny';
}


interface ParsedACL {
    permissions: ACLEntry[];
    inheritance: string | null;
}

const PERMISSION_MAP: Record<string, string> = {
    // Full control
    'F': 'Full control',

    // Modify
    'M': 'Modify',

    // Read & Execute
    'RX': 'Read & Execute',

    // Read
    'R': 'Read',

    // Write
    'W': 'Write',

    // Execute/Traverse
    'X': 'Execute/Traverse',

    // Delete
    'D': 'Delete',

    // Read permissions
    'RC': 'Read permissions',

    // Change permissions
    'WDAC': 'Change permissions',

    // Take ownership
    'WO': 'Take ownership',

    // Synchronize
    'S': 'Synchronize',

    // Read data
    'RD': 'Read data',

    // Write data
    'WD': 'Write data',

    // Append data
    'AD': 'Append data',

    // Read extended attributes
    'REA': 'Read extended attributes',

    // Write extended attributes
    'WEA': 'Write extended attributes',

    // Delete child
    'DC': 'Delete child',

    // Read attributes
    'RA': 'Read attributes',

    // Write attributes
    'WA': 'Write attributes',

    // Inheritance flags
    'OI': 'Object inherit',
    'CI': 'Container inherit',
    'IO': 'Inherit only',
    'NP': 'No propagate inherit',
    'I': 'Inherited'
};

const INHERITANCE_FLAGS = ['OI', 'CI', 'IO', 'NP'];
const NON_SETTABLE_FLAGS = ['I'];

class ACLError extends Error {
    constructor(message: string, public code: string, public details?: any) {
        super(message);
        this.name = 'ACLError';
    }
}

@Injectable()
export class SetupExportsPathPermissionService {
    private readonly logger: LoggerService;
    private mappingCache: Map<string, Map<string, string>> = new Map();
    constructor(
        @Inject(LoggerFactory) private readonly loggerFactory: LoggerFactory,
        private readonly winShellService: WinShellService,
        private readonly redisService: RedisService
    ) {
        this.logger = this.loggerFactory.create(SetupExportsPathPermissionService.name);
    }

    async setupExportPathPermission(jobRunId: string) {
        const jobContext: JobManagerContext = await this.redisService.getJobManagerContext(jobRunId);
        if (!jobContext.jobConfig?.destinationFileServer?.protocols[0]?.type.includes(ProtocolTypes.SMB)) {
            this.logger.debug(`Identity mapping not available for jobRunId: ${jobRunId}`);
            return;
        }

        if (!jobContext.jobConfig?.options?.preservePermissions) {
            this.logger.debug(`Skipping ACL setup for jobRunId: ${jobRunId} - preservePermissions is disabled`);
            return;
        }

        this.logger.log(`Starting ACL setup for jobRunId: ${jobRunId}`);
        try {
            await this.setup(jobRunId, jobContext);
        } catch (error: unknown) {
            this.logger.error(`ACL setup failed for jobRunId: ${jobRunId}: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
            throw error;
        }
    }

    async setup(jobRunId: string, context: any): Promise<void> {
        this.logger.debug(`Starting ACL setup for job ${jobRunId}`);
        // Validate input parameters
        if (!context?.jobConfig?.destinationFileServer || !context?.jobConfig?.sourceFileServer) {
            this.logger.error('Invalid context: missing file server configuration');
            throw new Error('Invalid context: missing file server configuration');
        }

        // Step 1: Get ACLs from both source and destination.
        // Each fetch is isolated so a network error or icacls failure on one side
        // does not abort the entire setup; the affected ACL is treated as empty.
        const destinationAcl = await this.getFileACL(context.jobConfig.destinationFileServer, jobRunId);
        this.logger.debug(`Destination ACL: ${JSON.stringify(destinationAcl)}`);
        if (!destinationAcl) {
            this.logger.warn(`No ACL found on destination path ${context.jobConfig.destinationFileServer.path}`);
        }

        const sourceAcl = await this.getFileACL(context.jobConfig.sourceFileServer, jobRunId);
        this.logger.debug(`Source ACL: ${JSON.stringify(sourceAcl)}`);
        if (!sourceAcl) {
            this.logger.warn(`No ACL found on source path ${context.jobConfig.sourceFileServer.path}`);
        }

        // Step 2: Add source principals to destination
        if (sourceAcl?.permissions && sourceAcl.permissions.length > 0) {
            this.logger.debug(`Processing ${sourceAcl.permissions.length} principals from source`);

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
            this.logger.debug('No principals found in source ACL to add');
        }

        // Step 3: Remove principals from destination that are not in source
        const destAvailablePrincipals = destinationAcl?.permissions?.map(entry => this.normalizePrincipal(entry.principal)) || [];
        const sourceAvailablePrincipals = sourceAcl?.permissions?.map(entry => this.normalizePrincipal(entry.principal)) || [];

        const usersToRemoveSet = new Set(destAvailablePrincipals.filter(principal => !sourceAvailablePrincipals.includes(principal) ));
        const usersToRemove = Array.from(usersToRemoveSet);

        if (usersToRemove.length > 0) {
            this.logger.debug(`Removing ${usersToRemove.length} principals from destination: ${usersToRemove.join(', ')}`);

            for (const user of usersToRemove) {
                try {
                    const mappedPrincipal = this.mappingCache.get(jobRunId)?.get(user);
                    if (mappedPrincipal) {
                        this.logger.debug(`Using mapped principal ${mappedPrincipal} for removal instead of ${user}`);
                        continue;
                    }
                    await this.removePrincipals(context.jobConfig.destinationFileServer, user);
                } catch (error) {
                    this.logger.error(`Error removing principal ${user} from destination: ${error.message}`, error.stack);
                }
            }
        } else {
            this.logger.debug('No principals to remove from destination');
        }

        this.logger.debug(`ACL setup completed for job ${jobRunId}`);
    }

    private normalizePrincipal(principal: string): string {
        if (!principal) return '';

        // Don't lowercase SIDs (they start with S-)
        return principal.startsWith("S-") ? principal : principal.toLowerCase();
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
                const ownerIdentity = await this.redisService.getOwnerIdentity(jobRunId, principal, 'SID');
                if (ownerIdentity && ownerIdentity.startsWith('S-')) {
                    this.logger.debug(`Resolved principal ${principal} to ${ownerIdentity}`);
                    const command = `SidToName ${ownerIdentity}`;
                    const getIdentity = await this.winShellService.executeCommand(command);
                    if (getIdentity.stderr) {
                        this.logger.error(`Error resolving SID ${ownerIdentity} to name: ${getIdentity.stderr}`);
                        throw new Error(getIdentity.stderr);
                    } else {
                        const output = getIdentity.stdout.trim();
                        if (!output || output.toLowerCase() === "false") {
                            this.logger.error(`SID ${ownerIdentity} could not be resolved to a name.`);
                            throw new Error(`SID ${ownerIdentity} could not be resolved to a name.`);
                        } else {
                            this.logger.debug(`Resolved principal ${ownerIdentity} to ${output}`);
                         let cacheMap = this.mappingCache.get(jobRunId);
                            if (!cacheMap) {
                                cacheMap = new Map();
                                this.mappingCache.set(jobRunId, cacheMap);
                            }
                            cacheMap.set(this.normalizePrincipal(output), principal);
                            resolvedPrincipal = output;
                        }
                    }
                } else {
                    resolvedPrincipal = ownerIdentity ? ownerIdentity : principal;
                }
            }

            const command = `icacls "${filePath}" /grant "${resolvedPrincipal}:${permission}"`;
            this.logger.debug(`Executing command: ${command}`);

            const { stdout, stderr } = await this.winShellService.executeCommand(command);
            if (stderr) {
                this.logger.error(`Error adding principal ${resolvedPrincipal} to ${destinationPath.path}: ${stderr}`);
                throw new Error(stderr);
            }

            this.logger.debug(`Successfully added principal ${resolvedPrincipal} with permission ${permission} to ${destinationPath.path}`);
            this.logger.debug(`Command output: ${stdout}`);
        } catch (error) {
            this.logger.error(`Failed to add principal ${principal} to ${destinationPath.path}: ${error.message}`, error.stack);
            throw error;
        }
    }


    parseIcaclsOutput(output: string, givenPath: string): ParsedACL {
        if (!output || typeof output !== 'string') {
            throw new ACLError('Invalid icacls output', 'PARSE_ERROR', { output });
        }

        const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
        const permissions: ACLEntry[] = [];
        let inheritance: string | null = null;

        if (lines.length < 1) {
            throw new ACLError('Empty icacls output', 'PARSE_ERROR', { output });
        }

        const remaining = lines[0].replace(givenPath, '').trim();

        if (!givenPath) {
            throw new ACLError('Failed to parse file path from icacls output', 'PARSE_ERROR', { output });
        }

        // Parse first line if it contains ACL info
        if (remaining && remaining.match(/.+:\(.*\)/)) {
            try {
                this.parseAclLine(remaining, permissions);
            } catch (error) {
                this.logger.warn(`Failed to parse ACL line: ${remaining}`, error);
            }
        }

        // Parse remaining lines
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line ||
                line.startsWith('Successfully processed') ||
                line.startsWith('No mapping between account')) {
                continue;
            }

            try {
                this.parseAclLine(line, permissions);
            } catch (error) {
                this.logger.warn(`Failed to parse ACL line: ${line}`, error);
            }
        }

        return { permissions, inheritance };
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
            const { stdout, stderr } = await this.winShellService.executeCommand(command);

            if (stderr) {
                this.logger.warn(`Error getting ACL for ${filePath}: ${stderr}`);
                return null;
            }

            this.logger.debug(`Raw ACL output for ${filePath}: ${stdout}`);

            const parsedAcl: ParsedACL = this.parseIcaclsOutput(stdout, filePath);

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

    private parseAclLine(line: string, permissions: ACLEntry[]): void {
        if (!line || typeof line !== 'string') {
            throw new Error('Invalid ACL line');
        }

        const match = line.match(/^(.+?):(.*?)$/);
        if (!match) {
            throw new Error(`Invalid ACL line format: ${line}`);
        }

        const [, user, permissionsString] = match;
        if (!user || !permissionsString) {
            throw new Error(`Missing user or permissions in ACL line: ${line}`);
        }

        const entry: ACLEntry = {
            principal: user.trim(),
            permissions: [],
            accessType: 'allow' // default
        };

        const uniquePermissions = new Set<string>();
        const permissionGroups = permissionsString.match(/\([^)]+\)/g) || [];

        for (const group of permissionGroups) {
            const content = group.slice(1, -1);

            if (content.toUpperCase() === 'DENY') {
                entry.accessType = 'deny';
            } else if (content.length > 0) {
                try {
                    const perms = this.parsePermissionString(content, true);
                    perms.forEach(p => uniquePermissions.add(p.code));
                } catch (error) {
                    this.logger.warn(`Failed to parse permission string: ${content}`, error);
                }
            }
        }

        uniquePermissions.forEach(code => {
            entry.permissions.push({
                code,
                description: PERMISSION_MAP[code] || code
            });
        });

        if (entry.permissions.length > 0) {
            permissions.push(entry);
            this.logger.debug(`Added ${entry.accessType} entry for ${entry.principal} with ${entry.permissions.length} permissions`);
        }
    }

    private parsePermissionString(permStr: string, includeInheritance: boolean = true): Permission[] {
        if (!permStr || typeof permStr !== 'string') {
            return [];
        }

        const permissions: Permission[] = [];
        const parts = permStr.split(',');

        parts.forEach(part => {
            const trimmedPart = part.trim();
            if (trimmedPart && !trimmedPart.includes('(') && !trimmedPart.includes(')')) {
                const isInheritanceFlag = [...INHERITANCE_FLAGS, ...NON_SETTABLE_FLAGS].includes(trimmedPart);
                if (includeInheritance || !isInheritanceFlag) {
                    permissions.push({
                        code: trimmedPart,
                        description: PERMISSION_MAP[trimmedPart] || trimmedPart
                    });
                }
            }
        });

        return permissions;
    }

    async removePrincipals(destinationPath: FileServerDetails, principal: string): Promise<void> {
        if (!destinationPath || !principal) {
            throw new Error('Invalid parameters: destinationPath and principal are required');
        }

        const filePath = "\\\\" + path.join(destinationPath.hostname, destinationPath.path);
        const command = `icacls "${filePath}" /remove "${principal}"`;

        this.logger.debug(`Executing command: ${command}`);

        try {
            const { stdout, stderr } = await this.winShellService.executeCommand(command);
            if (stderr) {
                this.logger.error(`Error removing principal ${principal} from ${destinationPath.path}: ${stderr}`);
                throw new Error(stderr);
            }
            this.logger.debug(`Successfully removed principal ${principal} from ${destinationPath.path}`);
            this.logger.debug(`Command output: ${stdout}`);
        } catch (error) {
            this.logger.error(`Failed to remove principal ${principal} from ${destinationPath.path}: ${error.message}`, error.stack);
            throw error;
        }
    }

    private formatPermissions(permissions: any[]): string {
        if (!permissions || permissions.length === 0) {
            return '';
        }

        const inheritanceFlags = [];
        const permissionCodes = [];

        permissions.forEach(p => {
            if (!p?.code || p.code.toUpperCase() === 'I') return;
            if (INHERITANCE_FLAGS.includes(p.code.toUpperCase())) {
                inheritanceFlags.push(p.code.toUpperCase());
            } else {
                permissionCodes.push(p.code.toUpperCase());
            }
        });

        // Each inheritance flag in its own (), other permissions grouped
        const inheritancePart = inheritanceFlags.map(flag => `(${flag})`).join('');
        const permissionPart = permissionCodes.length > 0 ? `(${permissionCodes.join(',')})` : '';

        return `${inheritancePart}${permissionPart}`;
    }

}