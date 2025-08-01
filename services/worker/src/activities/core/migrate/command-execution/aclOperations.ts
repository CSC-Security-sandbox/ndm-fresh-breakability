import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';

import {
    Permission,
    ACLEntry,
    ACLData,
    Operation,
    StampResult,
    StampOptions,
    GetACLOptions,
    ParsedACL,
    ComparisonResult,
    RedisService
} from './aclOperations.types';

import {
    PERMISSION_MAP,
    INHERITANCE_FLAGS,
    NON_SETTABLE_FLAGS,
    SID_REGEX,
    COMMAND_TIMEOUT
} from './aclOperations.constants';

import {
    ACLError,
    FileAccessError,
    CommandExecutionError,
    TimeoutError
} from './aclOperations.errors';

const execAsync = promisify(exec);

// Execute command with proper cleanup
async function executeCommand(command: string): Promise<{ stdout: string; stderr: string }> {
    const controller = new AbortController();
    const { signal } = controller;

    try {
        const result = await execAsync(command, {
            encoding: 'utf8',
            shell: 'cmd.exe',
            signal,
            windowsHide: true,
            timeout: COMMAND_TIMEOUT
        });
        return result;
    } catch (error) {
        if ((error as any).code === 'ETIMEDOUT') {
            throw new TimeoutError(command, COMMAND_TIMEOUT);
        }
        throw error;
    } finally {
        controller.abort();
    }
}

// ACL Operations class
export class ACLOperations {
    constructor(private redisService?: RedisService) { }

    private async resolvePrincipal(principal: string, jobID?: string): Promise<string> {
        if (!this.redisService || !jobID || !SID_REGEX.test(principal)) {
            return principal;
        }

        try {
            const resolvedName = await this.redisService.getOwnerIdentity(jobID, principal, 'SID');
            return resolvedName || principal;
        } catch (error) {
            return principal;
        }
    }

    private async getFileACL(filePath: string, options: GetACLOptions = {}): Promise<ACLData> {
        const { resolveSIDs = false, isIdentityMappingAvailable = false, jobID } = options;

        try {
            const normalizedPath = path.resolve(filePath);

            try {
                await fs.access(normalizedPath);
            } catch (error) {
                throw new FileAccessError(normalizedPath, error as Error);
            }

            const command = `icacls "${normalizedPath}" /L`;
            let stdout: string, stderr: string;

            try {
                ({ stdout, stderr } = await executeCommand(command));
            } catch (error) {
                // Check if it's a file not found error
                const errorMessage = (error as Error).message || '';
                if (errorMessage.includes('The system cannot find the file specified') ||
                    errorMessage.includes('cannot find the path specified')) {
                    throw new FileAccessError(normalizedPath, error as Error);
                }
                throw new CommandExecutionError(command, error as Error);
            }

            if (stderr && !stderr.includes('Successfully processed')) {
                // Check for file not found in stderr
                if (stderr.includes('The system cannot find the file specified') ||
                    stderr.includes('cannot find the path specified')) {
                    throw new FileAccessError(normalizedPath, new Error(stderr));
                }
                throw new ACLError(`Error executing icacls: ${stderr}`, 'ICACLS_ERROR', { stderr });
            }

            const aclData = this.parseIcaclsOutput(stdout);

            // Only resolve SIDs if both flags are true and jobID is provided
            if (resolveSIDs && isIdentityMappingAvailable && jobID && this.redisService) {
                for (const entry of aclData.permissions) {
                    const resolved = await this.resolvePrincipal(entry.principal, jobID);
                    if (resolved !== entry.principal) {
                        entry.originalPrincipal = entry.principal;
                        entry.principal = resolved;
                    }
                }
            } else {
                console.log(`Not resolving SIDs: resolveSIDs=${resolveSIDs}, isIdentityMappingAvailable=${isIdentityMappingAvailable}, jobID=${jobID}, redisService=${!!this.redisService}`);
            }

            return {
                filePath: normalizedPath,
                timestamp: new Date().toISOString(),
                user: process.env.USERNAME || 'unknown',
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

    async stampFileACL(
        sourceFile: string,
        targetFile: string,
        options: StampOptions = {}
    ): Promise<StampResult> {
        const {
            preserveExisting = false,
            excludePrincipals = [],
            includePrincipals = [],
            resolveSIDs = false,
            isIdentityMappingAvailable = false,
            jobID
        } = options;

        try {
            const sourcePath = path.resolve(sourceFile);
            const targetPath = path.resolve(targetFile);

            try {
                await Promise.all([
                    fs.access(sourcePath),
                    fs.access(targetPath)
                ]);
            } catch (error) {
                const failedPath = await fs.access(sourcePath).then(() => targetPath, () => sourcePath);
                throw new FileAccessError(failedPath, error as Error);
            }

            // Only resolve SIDs if both flags are true and jobID is provided
            const shouldResolveSIDs = resolveSIDs && isIdentityMappingAvailable && !!jobID;
            const sourceACL = await this.getFileACL(sourcePath, {
                resolveSIDs: shouldResolveSIDs,
                isIdentityMappingAvailable,
                jobID
            });

            const result: StampResult = {
                source: sourcePath,
                target: targetPath,
                timestamp: new Date().toISOString(),
                user: process.env.USERNAME || 'unknown',
                operations: [],
                commands: [],
                success: true
            };

            // Reset permissions if not preserving
            if (!preserveExisting) {
                const resetCmd = `icacls "${targetPath}" /reset`;
                try {
                    await executeCommand(resetCmd);
                } catch (error) {
                    result.operations.push({
                        type: 'reset',
                        status: 'failed',
                        error: (error as Error).message
                    });
                    result.success = false;
                    throw new CommandExecutionError(resetCmd, error as Error);
                }
                result.commands.push(resetCmd);
                result.operations.push({
                    type: 'reset',
                    status: 'completed'
                });

                // Option 1: Remove all explicit permissions after reset
                // This would require using /remove commands for each default principal
                // const removeCmd = `icacls "${targetPath}" /inheritance:r`;
                // await executeCommand(removeCmd);
            }

            // Apply each permission
            for (const permission of sourceACL.permissions) {
                const { principal, originalPrincipal, permissions, accessType } = permission;

                // Skip unresolved SIDs when identity mapping is enabled
                if (isIdentityMappingAvailable && resolveSIDs) {
                    if (SID_REGEX.test(principal)) {
                        result.operations.push({
                            type: 'skip',
                            principal: principal,
                            reason: 'unresolved SID with identity mapping enabled',
                            status: 'skipped'
                        });
                        continue;
                    }
                }

                // When identity mapping is available, use the resolved name for the command
                // Otherwise, use the original principal (SID or name)
                let principalForCommand: string;
                if (isIdentityMappingAvailable && resolveSIDs && originalPrincipal) {
                    // Use the resolved name (e.g., DESKTOP-EBFPEK8\sham)
                    principalForCommand = principal;
                } else {
                    // Use the original principal (SID or name as it came from source)
                    principalForCommand = originalPrincipal || principal;
                }

                const principalForFiltering = principal; // This will be the resolved name if mapping was applied

                // Check filters using the resolved principal name
                if (excludePrincipals.includes(principalForFiltering)) {
                    result.operations.push({
                        type: 'skip',
                        principal: principalForFiltering,
                        reason: 'excluded',
                        status: 'skipped'
                    });
                    continue;
                }

                if (includePrincipals.length > 0 && !includePrincipals.includes(principalForFiltering)) {
                    result.operations.push({
                        type: 'skip',
                        principal: principalForFiltering,
                        reason: 'not included',
                        status: 'skipped'
                    });
                    continue;
                }

                // Separate inheritance flags from actual permissions
                // Exclude 'I' (Inherited) flag as it cannot be set manually
                const inheritanceFlags = permissions.filter(p => INHERITANCE_FLAGS.includes(p.code));
                const actualPermissions = permissions.filter(p =>
                    !INHERITANCE_FLAGS.includes(p.code) && !NON_SETTABLE_FLAGS.includes(p.code)
                );

                // Skip if no actual permissions to set (e.g., only had 'I' flag)
                if (actualPermissions.length === 0 && inheritanceFlags.length === 0) {
                    result.operations.push({
                        type: 'skip',
                        principal: principalForFiltering,
                        reason: 'no settable permissions',
                        status: 'skipped'
                    });
                    continue;
                }

                // Build permission string with inheritance flags first, then permissions
                const inheritanceString = inheritanceFlags.map(p => p.code).join(',');
                const permissionString = actualPermissions.map(p => p.code).join(',');
                const fullPermString = inheritanceString ?
                    (permissionString ? `${inheritanceString},${permissionString}` : inheritanceString) :
                    permissionString;

                const commandType = accessType === 'deny' ? 'deny' : 'grant';
                const aclCmd = `icacls "${targetPath}" /${commandType} "${principalForCommand}:(${fullPermString})"`;

                try {
                    const cmdResult = await executeCommand(aclCmd);
                    result.operations.push({
                        type: commandType as 'grant' | 'deny',
                        principal: principalForFiltering,
                        permissions: fullPermString,
                        status: 'completed'
                    });
                } catch (error) {
                    result.operations.push({
                        type: commandType as 'grant' | 'deny',
                        principal: principalForFiltering,
                        permissions: fullPermString,
                        status: 'failed',
                        error: (error as Error).message
                    });
                    result.success = false;
                }

                result.commands.push(aclCmd);
            }

            return result;

        } catch (error) {
            if (error instanceof ACLError) {
                throw error;
            }
            throw new ACLError(`Failed to stamp ACL`, 'STAMP_ERROR', { originalError: (error as Error).message });
        }
    }

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

            // Check for deny permissions - they appear with (N) or (DENY) prefix
            const isDeny = line.includes('(DENY)') || /:\(N\)/.test(line);

            // Updated regex to handle deny format like "principal:(N)(permissions)"
            const match = line.match(/^(.+?):\s*(?:\(DENY\)|(?:\(N\)))?\s*\(([^)]+)\)(?:\(([^)]+)\))?$/);
            if (match) {
                const [, principal, permission1, permission2] = match;
                const entry: ACLEntry = {
                    principal: principal.trim(),
                    permissions: [],
                    accessType: isDeny ? 'deny' : 'allow'
                };

                // For deny permissions, skip the (N) part and parse actual permissions
                if (permission1 && permission1 !== 'N') {
                    entry.permissions.push(...this.parsePermissionString(permission1, true));
                }
                if (permission2) {
                    entry.permissions.push(...this.parsePermissionString(permission2, true));
                }

                // Only add entry if it has permissions
                if (entry.permissions.length > 0) {
                    permissions.push(entry);
                }
            }
        }

        return { permissions, inheritance };
    }

    private parsePermissionString(permStr: string, includeInheritance: boolean = true): Permission[] {
        const permissions: Permission[] = [];
        const parts = permStr.split(',');

        parts.forEach(part => {
            const trimmedPart = part.trim();
            if (trimmedPart && !trimmedPart.includes('(') && !trimmedPart.includes(')')) {
                // Include inheritance flags like OI, CI, IO, NP, I
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

    private arePermissionsEqual(perms1: Permission[], perms2: Permission[]): boolean {
        // Filter out the 'I' (Inherited) flag from both sides for comparison
        // since it's automatically set by Windows and can't be manually controlled
        const filterInherited = (perms: Permission[]) =>
            perms.filter(p => !NON_SETTABLE_FLAGS.includes(p.code));

        const filtered1 = filterInherited(perms1);
        const filtered2 = filterInherited(perms2);

        if (filtered1.length !== filtered2.length) return false;

        const codes1 = filtered1.map(p => p.code).sort();
        const codes2 = filtered2.map(p => p.code).sort();

        return codes1.every((code, index) => code === codes2[index]);
    }

    async compareFileACLs(
        sourceFile: string,
        targetFile: string,
        options: GetACLOptions = {}
    ): Promise<ComparisonResult> {
        try {
            const { resolveSIDs = false, isIdentityMappingAvailable = false, jobID } = options;

            // For comparison, we should NOT resolve SIDs on the target
            // because the target will have the actual usernames, not the source SIDs
            const sourceACL = await this.getFileACL(sourceFile, {
                resolveSIDs: resolveSIDs && isIdentityMappingAvailable && !!jobID,
                isIdentityMappingAvailable,
                jobID
            });

            // Get target ACL without SID resolution
            const targetACL = await this.getFileACL(targetFile, {
                resolveSIDs: false,
                isIdentityMappingAvailable: false,
                jobID: undefined
            });

            const sourcePrincipals = new Map<string, ACLEntry>();
            const targetPrincipals = new Map<string, ACLEntry>();

            // For source entries, use the resolved principal for comparison if available
            sourceACL.permissions.forEach(p => {
                const keyPrincipal = p.principal; // This will be the resolved name if mapping was applied
                const key = `${keyPrincipal}:${p.accessType}`;
                sourcePrincipals.set(key, p);
            });

            targetACL.permissions.forEach(p => {
                const key = `${p.principal}:${p.accessType}`;
                targetPrincipals.set(key, p);
            });

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

            for (const [key, entry] of sourcePrincipals) {
                if (!targetPrincipals.has(key)) {
                    onlyInSource.push(entry);
                } else {
                    const targetEntry = targetPrincipals.get(key)!;
                    if (!this.arePermissionsEqual(entry.permissions, targetEntry.permissions)) {
                        different.push({
                            principal: `${entry.principal} (${entry.accessType})`,
                            sourcePermissions: entry.permissions,
                            targetPermissions: targetEntry.permissions
                        });
                    } else {
                        identical.push({
                            principal: `${entry.principal} (${entry.accessType})`,
                            permissions: entry.permissions
                        });
                    }
                }
            }

            for (const [key, entry] of targetPrincipals) {
                if (!sourcePrincipals.has(key)) {
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
}

// Export standalone functions
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

// Re-export everything
export * from './aclOperations.types';
export * from './aclOperations.constants';
export * from './aclOperations.errors';