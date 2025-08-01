import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

// Type definitions
interface Permission {
    code: string;
    description: string;
}

interface ACLEntry {
    principal: string;
    originalPrincipal?: string; // Store original SID if resolved
    permissions: Permission[];
}

interface ACLData {
    filePath: string;
    timestamp: string;
    user: string;
    permissions: ACLEntry[];
    inheritance: string | null;
}

interface Operation {
    type: 'reset' | 'grant' | 'skip';
    principal?: string;
    permissions?: string;
    status: 'completed' | 'failed' | 'simulated' | 'skipped';
    reason?: string;
    error?: string;
}

interface StampResult {
    source: string;
    target: string;
    timestamp: string;
    user: string;
    operations: Operation[];
    commands: string[];
    success: boolean;
}

interface StampOptions {
    preserveExisting?: boolean;
    excludePrincipals?: string[];
    includePrincipals?: string[];
    simulate?: boolean;
    resolveSIDs?: boolean;
}

interface GetACLOptions {
    resolveSIDs?: boolean;
}

interface ExportedACL {
    version: string;
    exported: {
        timestamp: string;
        user: string;
        source: string;
    };
    acl: {
        permissions: ACLEntry[];
        inheritance: string | null;
    };
}

interface ParsedACL {
    permissions: ACLEntry[];
    inheritance: string | null;
}

interface ComparisonResult {
    source: ACLData;
    target: ACLData;
    isEqual: boolean;
    differences: {
        onlyInSource: ACLEntry[];
        onlyInTarget: ACLEntry[];
        different: Array<{
            principal: string;
            sourcePermissions: Permission[];
            targetPermissions: Permission[];
        }>;
        identical: Array<{
            principal: string;
            permissions: Permission[];
        }>;
    };
}

// Custom error classes
export class ACLError extends Error {
    constructor(message: string, public code: string, public details?: any) {
        super(message);
        this.name = 'ACLError';
    }
}

export class FileAccessError extends ACLError {
    constructor(filePath: string, originalError: Error) {
        super(`Cannot access file: ${filePath}`, 'FILE_ACCESS_ERROR', { filePath, originalError: originalError.message });
    }
}

export class CommandExecutionError extends ACLError {
    constructor(command: string, originalError: Error) {
        super(`Command execution failed: ${command}`, 'COMMAND_ERROR', { command, originalError: originalError.message });
    }
}

// Redis service interface
interface RedisService {
    getOwnerIdentity(sid: string): Promise<string | null>;
}

// Permission mapping
const PERMISSION_MAP: Record<string, string> = {
    'F': 'Full Control',
    'M': 'Modify',
    'RX': 'Read & Execute',
    'R': 'Read',
    'W': 'Write',
    'D': 'Delete',
    'DE': 'Delete',
    'RC': 'Read Control',
    'WDAC': 'Write DAC',
    'WO': 'Write Owner',
    'S': 'Synchronize',
    'AS': 'Access System Security',
    'MA': 'Maximum Allowed',
    'GR': 'Generic Read',
    'GW': 'Generic Write',
    'GE': 'Generic Execute',
    'GA': 'Generic All',
    'RD': 'Read Data/List Directory',
    'WD': 'Write Data/Add File',
    'AD': 'Append Data/Add Subdirectory',
    'REA': 'Read Extended Attributes',
    'WEA': 'Write Extended Attributes',
    'X': 'Execute/Traverse',
    'DC': 'Delete Child',
    'RA': 'Read Attributes',
    'WA': 'Write Attributes'
};

// ACL Operations class with Redis integration
export class ACLOperations {
    constructor(private redisService?: RedisService) { }

    /**
     * Check if a string is a SID
     */
    private isSID(principal: string): boolean {
        return /^S-\d-\d+-(\d+-){1,14}\d+$/.test(principal);
    }

    /**
     * Resolve SIDs to readable names
     */
    private async resolvePrincipal(principal: string): Promise<string> {
        if (!this.redisService || !this.isSID(principal)) {
            return principal;
        }

        try {
            const resolvedName = await this.redisService.getOwnerIdentity(principal);
            return resolvedName || principal;
        } catch (error) {
            console.warn(`Failed to resolve SID ${principal}: ${(error as Error).message}`);
            return principal;
        }
    }

    /**
     * Get ACL of a file in object format
     */
    async getFileACL(filePath: string, options: GetACLOptions = {}): Promise<ACLData> {
        const { resolveSIDs = false } = options;

        try {
            const normalizedPath = path.resolve(filePath);

            // Verify file exists
            try {
                await fs.access(normalizedPath);
            } catch (error) {
                throw new FileAccessError(normalizedPath, error as Error);
            }

            // Use icacls to get ACL
            const command = `icacls "${normalizedPath}" /L`;
            let stdout: string, stderr: string;

            try {
                ({ stdout, stderr } = await execAsync(command, {
                    encoding: 'utf8',
                    shell: 'cmd.exe'
                }));
            } catch (error) {
                throw new CommandExecutionError(command, error as Error);
            }

            if (stderr) {
                throw new ACLError(`Error executing icacls: ${stderr}`, 'ICACLS_ERROR', { stderr });
            }

            // Parse the output
            const aclData = this.parseIcaclsOutput(stdout);

            // Resolve SIDs if requested
            if (resolveSIDs && this.redisService) {
                for (const entry of aclData.permissions) {
                    if (this.isSID(entry.principal)) {
                        const resolved = await this.resolvePrincipal(entry.principal);
                        if (resolved !== entry.principal) {
                            entry.originalPrincipal = entry.principal;
                            entry.principal = resolved;
                        }
                    }
                }
            }

            return {
                filePath: normalizedPath,
                timestamp: new Date().toISOString(),
                user: 'VishalBikkad',
                permissions: aclData.permissions,
                inheritance: aclData.inheritance
            };

        } catch (error) {
            if (error instanceof ACLError) {
                throw error;
            }
            throw new ACLError(`Failed to get ACL for ${filePath}`, 'UNKNOWN_ERROR', { originalError: (error as Error).message });
        }
    }

    /**
     * Apply ACL from one file to another
     */
    async stampFileACL(
        sourceFile: string,
        targetFile: string,
        options: StampOptions = {}
    ): Promise<StampResult> {
        const {
            preserveExisting = false,
            excludePrincipals = [],
            includePrincipals = [],
            simulate = false,
            resolveSIDs = false
        } = options;

        try {
            const sourcePath = path.resolve(sourceFile);
            const targetPath = path.resolve(targetFile);

            // Verify both files exist
            try {
                await Promise.all([
                    fs.access(sourcePath),
                    fs.access(targetPath)
                ]);
            } catch (error) {
                const failedPath = await fs.access(sourcePath).then(() => targetPath, () => sourcePath);
                throw new FileAccessError(failedPath, error as Error);
            }

            // Get source ACL
            const sourceACL = await this.getFileACL(sourcePath, { resolveSIDs });

            const result: StampResult = {
                source: sourcePath,
                target: targetPath,
                timestamp: new Date().toISOString(),
                user: 'VishalBikkad',
                operations: [],
                commands: [],
                success: true
            };

            // Reset permissions if not preserving
            if (!preserveExisting) {
                const resetCmd = `icacls "${targetPath}" /reset`;
                if (!simulate) {
                    try {
                        await execAsync(resetCmd, { shell: 'cmd.exe' });
                    } catch (error) {
                        result.operations.push({
                            type: 'reset',
                            status: 'failed',
                            error: (error as Error).message
                        });
                        result.success = false;
                        throw new CommandExecutionError(resetCmd, error as Error);
                    }
                }
                result.commands.push(resetCmd);
                result.operations.push({
                    type: 'reset',
                    status: simulate ? 'simulated' : 'completed'
                });
            }

            // Apply each permission
            for (const permission of sourceACL.permissions) {
                const { principal, originalPrincipal, permissions } = permission;

                // Use original SID for actual command if it was resolved
                const principalForCommand = originalPrincipal || principal;

                // Check filters (use resolved name for filtering)
                if (excludePrincipals.includes(principal)) {
                    result.operations.push({
                        type: 'skip',
                        principal,
                        reason: 'excluded',
                        status: 'skipped'
                    });
                    continue;
                }

                if (includePrincipals.length > 0 && !includePrincipals.includes(principal)) {
                    result.operations.push({
                        type: 'skip',
                        principal,
                        reason: 'not included',
                        status: 'skipped'
                    });
                    continue;
                }

                // Build and execute grant command
                const permString = permissions.map(p => p.code).join(',');
                const grantCmd = `icacls "${targetPath}" /grant "${principalForCommand}:(${permString})"`;

                if (!simulate) {
                    try {
                        await execAsync(grantCmd, { shell: 'cmd.exe' });
                        result.operations.push({
                            type: 'grant',
                            principal: resolveSIDs ? principal : principalForCommand,
                            permissions: permString,
                            status: 'completed'
                        });
                    } catch (error) {
                        result.operations.push({
                            type: 'grant',
                            principal: resolveSIDs ? principal : principalForCommand,
                            permissions: permString,
                            status: 'failed',
                            error: (error as Error).message
                        });
                        result.success = false;
                    }
                } else {
                    result.operations.push({
                        type: 'grant',
                        principal: resolveSIDs ? principal : principalForCommand,
                        permissions: permString,
                        status: 'simulated'
                    });
                }

                result.commands.push(grantCmd);
            }

            return result;

        } catch (error) {
            if (error instanceof ACLError) {
                throw error;
            }
            throw new ACLError(`Failed to stamp ACL`, 'STAMP_ERROR', { originalError: (error as Error).message });
        }
    }

    /**
     * Compare ACLs between two files
     */
    async compareFileACLs(
        sourceFile: string,
        targetFile: string,
        options: GetACLOptions = {}
    ): Promise<ComparisonResult> {
        try {
            const [sourceACL, targetACL] = await Promise.all([
                this.getFileACL(sourceFile, options),
                this.getFileACL(targetFile, options)
            ]);

            const sourcePrincipals = new Map(sourceACL.permissions.map(p => [p.principal, p]));
            const targetPrincipals = new Map(targetACL.permissions.map(p => [p.principal, p]));

            const onlyInSource: ACLEntry[] = [];
            const onlyInTarget: ACLEntry[] = [];
            const different: Array<{
                principal: string;
                sourcePermissions: Permission[];
                targetPermissions: Permission[];
            }> = [];
            const identical: Array<{
                principal: string;
                permissions: Permission[];
            }> = [];

            // Check source principals
            for (const [principal, entry] of sourcePrincipals) {
                if (!targetPrincipals.has(principal)) {
                    onlyInSource.push(entry);
                } else {
                    const targetEntry = targetPrincipals.get(principal)!;
                    if (!this.arePermissionsEqual(entry.permissions, targetEntry.permissions)) {
                        different.push({
                            principal,
                            sourcePermissions: entry.permissions,
                            targetPermissions: targetEntry.permissions
                        });
                    } else {
                        identical.push({
                            principal,
                            permissions: entry.permissions
                        });
                    }
                }
            }

            // Check for principals only in target
            for (const [principal, entry] of targetPrincipals) {
                if (!sourcePrincipals.has(principal)) {
                    onlyInTarget.push(entry);
                }
            }

            const isEqual = onlyInSource.length === 0 &&
                onlyInTarget.length === 0 &&
                different.length === 0;

            return {
                source: sourceACL,
                target: targetACL,
                isEqual,
                differences: {
                    onlyInSource,
                    onlyInTarget,
                    different,
                    identical
                }
            };
        } catch (error) {
            if (error instanceof ACLError) {
                throw error;
            }
            throw new ACLError(`Failed to compare ACLs`, 'COMPARE_ERROR', { originalError: (error as Error).message });
        }
    }

    /**
     * Get ACL as exportable/importable data structure
     */
    async exportFileACL(filePath: string, options: GetACLOptions = {}): Promise<ExportedACL> {
        const acl = await this.getFileACL(filePath, options);

        return {
            version: '1.0',
            exported: {
                timestamp: new Date().toISOString(),
                user: 'VishalBikkad',
                source: acl.filePath
            },
            acl: {
                permissions: acl.permissions,
                inheritance: acl.inheritance
            }
        };
    }

    /**
     * Apply ACL from exported data to a file
     */
    async importFileACL(
        targetFile: string,
        aclData: ExportedACL,
        options: { simulate?: boolean } = {}
    ): Promise<StampResult> {
        const { simulate = false } = options;

        try {
            const targetPath = path.resolve(targetFile);

            try {
                await fs.access(targetPath);
            } catch (error) {
                throw new FileAccessError(targetPath, error as Error);
            }

            const result: StampResult = {
                source: aclData.exported.source,
                target: targetPath,
                timestamp: new Date().toISOString(),
                user: 'VishalBikkad',
                operations: [],
                commands: [],
                success: true
            };

            // Reset permissions
            const resetCmd = `icacls "${targetPath}" /reset`;
            if (!simulate) {
                try {
                    await execAsync(resetCmd, { shell: 'cmd.exe' });
                } catch (error) {
                    result.operations.push({
                        type: 'reset',
                        status: 'failed',
                        error: (error as Error).message
                    });
                    result.success = false;
                    throw new CommandExecutionError(resetCmd, error as Error);
                }
            }
            result.commands.push(resetCmd);
            result.operations.push({
                type: 'reset',
                status: simulate ? 'simulated' : 'completed'
            });

            // Apply permissions from data
            for (const permission of aclData.acl.permissions) {
                const principalForCommand = permission.originalPrincipal || permission.principal;
                const permString = permission.permissions.map(p => p.code).join(',');
                const grantCmd = `icacls "${targetPath}" /grant "${principalForCommand}:(${permString})"`;

                if (!simulate) {
                    try {
                        await execAsync(grantCmd, { shell: 'cmd.exe' });
                        result.operations.push({
                            type: 'grant',
                            principal: permission.principal,
                            status: 'completed'
                        });
                    } catch (error) {
                        result.operations.push({
                            type: 'grant',
                            principal: permission.principal,
                            status: 'failed',
                            error: (error as Error).message
                        });
                        result.success = false;
                    }
                } else {
                    result.operations.push({
                        type: 'grant',
                        principal: permission.principal,
                        status: 'simulated'
                    });
                }

                result.commands.push(grantCmd);
            }

            return result;

        } catch (error) {
            if (error instanceof ACLError) {
                throw error;
            }
            throw new ACLError(`Failed to import ACL`, 'IMPORT_ERROR', { originalError: (error as Error).message });
        }
    }

    /**
     * Parse icacls output into structured format
     */
    private parseIcaclsOutput(output: string): ParsedACL {
        const lines = output.split('\n').filter(line => line.trim());
        const permissions: ACLEntry[] = [];
        let inheritance: string | null = null;

        if (lines.length < 2) {
            throw new ACLError('Invalid icacls output', 'PARSE_ERROR', { output });
        }

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();

            if (!line || line.startsWith('Successfully processed')) {
                continue;
            }

            const match = line.match(/^(.+?):\(([^)]+)\)(?:\(([^)]+)\))?$/);
            if (match) {
                const [, principal, permission1, permission2] = match;
                const entry: ACLEntry = {
                    principal: principal.trim(),
                    permissions: []
                };

                if (permission1) {
                    entry.permissions.push(...this.parsePermissionString(permission1));
                }
                if (permission2) {
                    entry.permissions.push(...this.parsePermissionString(permission2));
                }

                permissions.push(entry);
            }
        }

        return { permissions, inheritance };
    }

    /**
     * Parse permission string into structured format
     */
    private parsePermissionString(permStr: string): Permission[] {
        const permissions: Permission[] = [];
        const parts = permStr.split(',');

        parts.forEach(part => {
            const trimmedPart = part.trim();
            if (trimmedPart) {
                permissions.push({
                    code: trimmedPart,
                    description: PERMISSION_MAP[trimmedPart] || trimmedPart
                });
            }
        });

        return permissions;
    }

    /**
     * Check if two permission arrays are equal
     */
    private arePermissionsEqual(perms1: Permission[], perms2: Permission[]): boolean {
        if (perms1.length !== perms2.length) return false;

        const codes1 = perms1.map(p => p.code).sort();
        const codes2 = perms2.map(p => p.code).sort();

        return codes1.every((code, index) => code === codes2[index]);
    }
}

// Export standalone functions for backward compatibility
export async function getFileACL(filePath: string, options?: GetACLOptions): Promise<ACLData> {
    const aclOps = new ACLOperations();
    return aclOps.getFileACL(filePath, options);
}

export async function stampFileACL(
    sourceFile: string,
    targetFile: string,
    options?: StampOptions
): Promise<StampResult> {
    const aclOps = new ACLOperations();
    return aclOps.stampFileACL(sourceFile, targetFile, options);
}

export async function compareFileACLs(
    sourceFile: string,
    targetFile: string,
    options?: GetACLOptions
): Promise<ComparisonResult> {
    const aclOps = new ACLOperations();
    return aclOps.compareFileACLs(sourceFile, targetFile, options);
}

export async function exportFileACL(
    filePath: string,
    options?: GetACLOptions
): Promise<ExportedACL> {
    const aclOps = new ACLOperations();
    return aclOps.exportFileACL(filePath, options);
}

export async function importFileACL(
    targetFile: string,
    aclData: ExportedACL,
    options?: { simulate?: boolean }
): Promise<StampResult> {
    const aclOps = new ACLOperations();
    return aclOps.importFileACL(targetFile, aclData, options);
}

// Re-export all types
export type {
    Permission,
    ACLEntry,
    ACLData,
    Operation,
    StampResult,
    StampOptions,
    ExportedACL,
    RedisService,
    GetACLOptions,
    ComparisonResult
};