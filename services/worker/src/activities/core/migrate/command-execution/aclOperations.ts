import { Inject, Injectable, LoggerService } from "@nestjs/common";
import { ACLData, ACLEntry, ComparisonResult, GetACLOptions, ParsedACL, Permission, StampOptions, StampResult } from "./aclOperations.types";
import { LoggerFactory } from "@netapp-cloud-datamigrate/logger-lib";
import * as path from 'path';
import { ACLError, CommandExecutionError, FileAccessError, TimeoutError } from "./aclOperations.errors";
import { INHERITANCE_FLAGS, NON_SETTABLE_FLAGS, PERMISSION_MAP, SID_REGEX } from "./aclOperations.constants";
import { RedisService } from "src/redis/redis.service";
import { ShellPoolExecutorService } from "./shell-for-meta-stamping.service";

@Injectable()
export class AclOperations {
    private readonly logger: LoggerService;
    private principalCache = new Map<string, Map<string, string>>();

    constructor(
        private redisService: RedisService,
        private shellPool: ShellPoolExecutorService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    ) {
        this.logger = loggerFactory.create(AclOperations.name);
    }

    failedNumGt0 = (out: string) => Number(out.match(/Failed processing\s*(\d+)\s*files/i)?.[1] || 0) > 0;

    async stampFileACL(sourceFile: string, targetFile: string, options?: StampOptions): Promise<StampResult> {
        if (!sourceFile || typeof sourceFile !== 'string') {
            throw new ACLError('Invalid source file path', 'INVALID_INPUT', {
                sourceFile: sourceFile,
                sourceFileType: typeof sourceFile,
                sourceFileLength: sourceFile ? sourceFile.length : 'N/A'
            });
        }
        if (!targetFile || typeof targetFile !== 'string') {
            throw new ACLError('Invalid target file path', 'INVALID_INPUT', {
                targetFile: targetFile,
                targetFileType: typeof targetFile,
                targetFileLength: targetFile ? targetFile.length : 'N/A'
            });
        }

        // Check for common path issues before resolution
        if (sourceFile.trim() === '') {
            throw new ACLError('Source file path is empty', 'INVALID_INPUT', { sourceFile });
        }
        if (targetFile.trim() === '') {
            throw new ACLError('Target file path is empty', 'INVALID_INPUT', { targetFile });
        }

        const {
            preserveExisting = false,
            excludePrincipals = [],
            includePrincipals = [],
            isIdentityMappingAvailable = false,
            jobID,
            disableInheritance = false,
        } = options || {};

        let sourcePath: string;
        let targetPath: string;


        sourcePath = path.resolve(sourceFile);

        targetPath = path.resolve(targetFile);

        const result: StampResult = {
            source: sourcePath,
            target: targetPath,
            timestamp: new Date().toISOString(),
            operations: [],
            commands: [],
            success: true
        };

        try {
            this.logger.debug(`Starting ACL stamp operation from ${sourcePath} to ${targetPath}`);

            if (!this.shellPool) {
                throw new ACLError('Shell pool executor not initialized', 'SHELL_POOL_ERROR');
            }

            // Get source ACL with better error context
            let sourceACL: ACLData;
            try {
                sourceACL = await this.getFileACL(sourcePath, {
                    isIdentityMappingAvailable,
                    jobID
                });
            } catch (error) {
                throw new ACLError('Failed to read source file ACL', 'SOURCE_ACL_READ_ERROR', {
                    sourcePath,
                    originalError: error instanceof Error ? error.message : String(error)
                });
            }

            // Validate ACL data
            if (!sourceACL || !Array.isArray(sourceACL.permissions)) {
                throw new ACLError('Invalid ACL data retrieved from source file', 'INVALID_ACL_DATA', { sourcePath, sourceACL });
            }

            const denyPermissions = sourceACL.permissions.filter(p => p.accessType === 'deny');
            const grantPermissions = sourceACL.permissions.filter(p => p.accessType === 'allow');
            const allPermissions = [...denyPermissions, ...grantPermissions];

            const enabledInheritance = allPermissions.some(permission => {
                return permission.permissions.some(perm => {
                    return perm.code === "I"
                });
            });

            try {
                const cmdForInheritance = `icacls "${targetPath}" /inheritance:${enabledInheritance ? 'e' : 'd'}`;
                this.logger.debug(`Disabling inheritance on ${targetPath} , ${cmdForInheritance}`);
                const { stdout, stderr } = await this.shellPool.executeCommand(cmdForInheritance);
                if (stderr) {
                    this.logger.error(`Failed to disable inheritance on ${targetPath}`, stderr);
                } else {
                    this.logger.debug(`Successfully disabled inheritance on ${targetPath}`, stdout);
                }
            } catch (error) {
                this.logger.error(`Failed to disable inheritance on ${targetPath}`, error);
            }

            const allEffectivePermissions = allPermissions.filter(permission => {
                return !permission.permissions.some(perm => perm.code === "I");
            });

            this.logger.debug(`Processing ${JSON.stringify(allEffectivePermissions)} permissions (${denyPermissions.length} deny, ${grantPermissions.length} allow)`);

            for (const permission of allEffectivePermissions) {
                try {
                    await this.processPermission(permission, targetPath, result, isIdentityMappingAvailable);
                } catch (error) {
                    this.logger.error(`Failed to process permission for principal ${permission.principal}`, error);
                    result.operations.push({
                        type: 'skip',
                        principal: permission.principal,
                        reason: `Processing error: ${(error as Error).message}`,
                        status: 'failed',
                        error: (error as Error).message
                    });
                    result.success = false;
                }
            }

            this.logger.debug(`ACL stamp completed. Success: ${result.success}, Operations: ${result.operations.length}`);
            return result;

        } catch (error) {
            this.logger.error(`Failed to stamp ACL from ${sourceFile} to ${targetFile}`, error);
            result.success = false;

            if (error instanceof ACLError) {
                throw error;
            }
            throw new ACLError('Failed to stamp ACL', 'STAMP_ERROR', {
                sourceFile,
                targetFile,
                originalError: (error as Error).message,
                stack: (error as Error).stack
            });
        }
    }

    private async processPermission(
        permission: ACLEntry,
        targetPath: string,
        result: StampResult,
        isIdentityMappingAvailable: boolean
    ): Promise<void> {
        const { principal, originalPrincipal, permissions, accessType } = permission;

        // Validate permission structure
        if (!principal || !Array.isArray(permissions)) {
            throw new Error('Invalid permission structure');
        }

        // Skip unresolved SIDs when identity mapping is available
        if (isIdentityMappingAvailable && SID_REGEX.test(principal)) {
            result.operations.push({
                type: 'skip',
                principal,
                reason: 'unresolved SID with identity mapping enabled',
                status: 'skipped'
            });
            return;
        }

        let principalForCommand = (isIdentityMappingAvailable && originalPrincipal) ? principal : (originalPrincipal || principal);
        principalForCommand = principalForCommand.replace(/\r|\n/g, ' ').trim();
        const principalForFiltering = principal;

        // Validate principal after cleaning
        if (!principalForCommand) {
            throw new Error('Principal name is empty after processing');
        }

        const inheritanceFlags = permissions.filter(p => INHERITANCE_FLAGS.includes(p.code));
        const actualPermissions = permissions.filter(p =>
            !INHERITANCE_FLAGS.includes(p.code) && !NON_SETTABLE_FLAGS.includes(p.code)
        );

        const uniqueInheritanceFlags = Array.from(new Set(inheritanceFlags.map(p => p.code))).map(code => ({ code, description: PERMISSION_MAP[code] || code }));
        const uniqueActualPermissions = Array.from(new Set(actualPermissions.map(p => p.code))).map(code => ({ code, description: PERMISSION_MAP[code] || code }));

        if (uniqueActualPermissions.length === 0 && uniqueInheritanceFlags.length === 0) {
            result.operations.push({
                type: 'skip',
                principal: principalForFiltering,
                reason: 'no settable permissions',
                status: 'skipped'
            });
            return;
        }

        // Optimize R + X to RX
        const hasRead = uniqueActualPermissions.some(p => p.code === 'R');
        const hasExecute = uniqueActualPermissions.some(p => p.code === 'X');
        const hasRX = uniqueActualPermissions.some(p => p.code === 'RX');

        if (hasRead && hasExecute && !hasRX) {
            const filteredPerms = uniqueActualPermissions.filter(p => p.code !== 'R' && p.code !== 'X');
            filteredPerms.push({ code: 'RX', description: 'Read & Execute' });
            uniqueActualPermissions.length = 0;
            uniqueActualPermissions.push(...filteredPerms);
        }

        const inheritanceCodes = uniqueInheritanceFlags.map(p => `(${p.code})`).join('');
        const permissionCodes = uniqueActualPermissions.length > 0 ? `(${uniqueActualPermissions.map(p => p.code).join(',')})` : '';
        const fullPermString = `${inheritanceCodes}${permissionCodes}`;

        if (!fullPermString) {
            result.operations.push({
                type: 'skip',
                principal: principalForFiltering,
                reason: 'empty permission string after processing',
                status: 'skipped'
            });
            return;
        }

        const aclCmd = accessType === 'deny'
            ? `icacls "${targetPath}" /deny "${principalForCommand}:${fullPermString}"`
            : `icacls "${targetPath}" /grant "${principalForCommand}:${fullPermString}"`;

        try {
            const { stdout, stderr } = await this.shellPool.executeCommand(aclCmd);
            if (this.failedNumGt0(stdout)) {
                throw new Error(stdout);
            }
            if (stderr) {
                throw new Error(stderr);
            }

            result.operations.push({
                type: accessType === 'deny' ? 'deny' : 'grant',
                principal: principalForFiltering,
                permissions: fullPermString,
                status: 'completed'
            });
        } catch (error) {
            const errorMessage = (error as Error).message || 'Unknown command execution error';

            if (errorMessage.includes('No mapping between account names and security IDs was done') ||
                errorMessage.includes('1332')) {
                this.logger.warn(`Unresolved SID for principal ${principalForFiltering}: ${errorMessage}`);
                result.operations.push({
                    type: 'skip',
                    principal: principalForFiltering,
                    reason: 'unresolved SID - no mapping found',
                    status: 'skipped'
                });
            } else if (errorMessage.includes('The filename, directory name, or volume label syntax is incorrect') ||
                errorMessage.includes('1123')) {
                this.logger.error(`Invalid path syntax for ${principalForFiltering}: ${errorMessage}`);
                result.operations.push({
                    type: 'skip',
                    principal: principalForFiltering,
                    reason: 'invalid path syntax',
                    status: 'failed',
                    error: errorMessage
                });
                result.success = false;
            } else {
                this.logger.error(`Failed to execute ACL command for ${principalForFiltering}: ${errorMessage}`);
                result.operations.push({
                    type: accessType === 'deny' ? 'deny' : 'grant',
                    principal: principalForFiltering,
                    permissions: fullPermString,
                    status: 'failed',
                    error: errorMessage
                });
                result.success = false;
            }
        }

        result.commands.push(aclCmd);
    }

    private async getFileACL(filePath: string, options: GetACLOptions): Promise<ACLData> {
        if (!filePath || typeof filePath !== 'string') {
            throw new ACLError('Invalid file path provided', 'INVALID_INPUT', { filePath });
        }

        const { isIdentityMappingAvailable = false, jobID } = options || {};
        const shouldResolveSIDs = isIdentityMappingAvailable && !!jobID;

        let normalizedPath: string;
        try {
            normalizedPath = path.resolve(filePath);
        } catch (error) {
            throw new ACLError('Failed to resolve file path', 'PATH_RESOLUTION_ERROR', {
                filePath,
                originalError: (error as Error).message
            });
        }

        try {
            const command = `icacls "${normalizedPath}" /L`;
            let stdout: string, stderr: string;

            try {
                ({ stdout, stderr } = await this.shellPool.executeCommand(command));
            } catch (error) {
                this.logger.error(`Error executing command "${command}" for file ${normalizedPath}`, error);
                const errorMessage = (error as Error).message || '';

                if (errorMessage.includes('The system cannot find the file specified') ||
                    errorMessage.includes('cannot find the path specified') ||
                    errorMessage.includes('2')) {
                    throw new FileAccessError(normalizedPath, error as Error);
                }
                if (errorMessage.includes('Access is denied') || errorMessage.includes('5')) {
                    throw new ACLError('Access denied reading ACL', 'ACCESS_DENIED', { normalizedPath });
                }
                throw new CommandExecutionError(command, error as Error);
            }

            // Validate command output
            if (!stdout) {
                throw new ACLError('No output received from icacls command', 'EMPTY_OUTPUT', { command });
            }

            if (stderr && !stderr.includes('Successfully processed')) {
                this.logger.error(`Error executing icacls for ${normalizedPath}: ${stderr}`);
                if (stderr.includes('The system cannot find the file specified') ||
                    stderr.includes('cannot find the path specified')) {
                    throw new FileAccessError(normalizedPath, new Error(stderr));
                }
                if (stderr.includes('Access is denied')) {
                    throw new ACLError('Access denied reading ACL', 'ACCESS_DENIED', { normalizedPath, stderr });
                }
                throw new ACLError(`Error executing icacls: ${stderr}`, 'ICACLS_ERROR', { stderr });
            }

            let aclData: ParsedACL;
            try {
                aclData = this.parseIcaclsOutput(stdout, normalizedPath);
            } catch (error) {
                throw new ACLError('Failed to parse icacls output', 'PARSE_ERROR', {
                    stdout,
                    normalizedPath,
                    originalError: (error as Error).message
                });
            }

            // Resolve SIDs if needed
            if (shouldResolveSIDs && aclData.permissions) {
                await Promise.allSettled(
                    aclData.permissions.map(async (entry) => {
                        try {
                            const resolved = await this.resolvePrincipal(entry.principal, jobID);
                            if (resolved !== entry.principal) {
                                entry.originalPrincipal = entry.principal;
                                entry.principal = resolved;
                            }
                        } catch (error) {
                            this.logger.debug(`Failed to resolve principal ${entry.principal}:`, error);
                        }
                    })
                );
            }

            this.logger.debug(`Parsed ACL for ${normalizedPath}: ${aclData.permissions.length} permissions`);

            return {
                filePath: normalizedPath,
                timestamp: new Date().toISOString(),
                permissions: aclData.permissions || [],
                inheritance: aclData.inheritance
            };

        } catch (error) {
            this.logger.error(`Failed to get ACL for ${filePath}`, error);
            if (error instanceof ACLError) {
                throw error;
            }
            throw new ACLError(`Failed to get ACL for ${filePath}`, 'UNKNOWN_ERROR', {
                filePath,
                originalError: (error as Error).message,
                stack: (error as Error).stack
            });
        }
    }

    async resolvePrincipal(principal: string, jobID?: string): Promise<string> {
        if (!principal || !this.redisService || !jobID || !SID_REGEX.test(principal)) {
            return principal;
        }

        let jobCache = this.principalCache.get(jobID);
        if (!jobCache) {
            jobCache = new Map();
            this.principalCache.set(jobID, jobCache);
        }

        if (jobCache.has(principal)) {
            const cached = jobCache.get(principal);
            return cached || principal;
        }

        try {
            const resolvedName = await this.redisService.getOwnerIdentity(jobID, principal, 'SID');
            const finalValue = resolvedName || principal;
            jobCache.set(principal, finalValue);
            return finalValue;
        } catch (error) {
            this.logger.error(`Failed to resolve SID ${principal}:`, error);
            jobCache.set(principal, principal); // Cache the failure to avoid repeated attempts
            return principal;
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

    async compareFileACLs(
        sourceFile: string,
        targetFile: string,
        options?: GetACLOptions
    ): Promise<ComparisonResult> {
        try {
            const { isIdentityMappingAvailable = false, jobID } = options;
            const sourceACL = await this.getFileACL(sourceFile, {
                isIdentityMappingAvailable,
                jobID
            });

            const targetACL = await this.getFileACL(targetFile, {
                isIdentityMappingAvailable: false,
                jobID: undefined
            });

            // Resolve principals in source ACL if mapping is available
            for (const p of sourceACL.permissions) {
                if (isIdentityMappingAvailable) {
                    const resolved = await this.resolvePrincipal(p.principal, jobID);
                    if (resolved && resolved !== p.principal) {
                        p.originalPrincipal = p.principal;
                        p.principal = resolved;
                    }
                }
            }

            // Group permissions by principal and access type to handle multiple entries
            const sourceByPrincipal = this.groupPermissionsByPrincipal(sourceACL.permissions);
            const targetByPrincipal = this.groupPermissionsByPrincipal(targetACL.permissions);

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

            // Get all unique principal:accessType combinations
            const allPrincipalKeys = new Set([
                ...Object.keys(sourceByPrincipal),
                ...Object.keys(targetByPrincipal)
            ]);

            for (const principalKey of allPrincipalKeys) {
                const sourceEntries = sourceByPrincipal[principalKey] || [];
                const targetEntries = targetByPrincipal[principalKey] || [];

                if (sourceEntries.length === 0) {
                    // Only in target
                    onlyInTarget.push(...targetEntries);
                } else if (targetEntries.length === 0) {
                    // Only in source
                    onlyInSource.push(...sourceEntries);
                } else {
                    // Compare combined permissions for this principal
                    const result = this.compareEntriesForPrincipal(sourceEntries, targetEntries);
                    if (result.isEqual) {
                        identical.push({
                            principal: principalKey,
                            permissions: result.combinedSourcePermissions
                        });
                    } else {
                        different.push({
                            principal: principalKey,
                            sourcePermissions: result.combinedSourcePermissions,
                            targetPermissions: result.combinedTargetPermissions
                        });
                    }
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

    private groupPermissionsByPrincipal(permissions: ACLEntry[]): Record<string, ACLEntry[]> {
        const grouped: Record<string, ACLEntry[]> = {};
        for (const perm of permissions) {
            const normalizedPrincipal = perm.principal.replace(/[\r\n]+/g, '').trim().toLowerCase();
            const key = `${normalizedPrincipal} (${perm.accessType.toLowerCase()})`;
            if (!grouped[key]) {
                grouped[key] = [];
            }
            grouped[key].push(perm);
        }
        return grouped;
    }

    private compareEntriesForPrincipal(
        sourceEntries: ACLEntry[],
        targetEntries: ACLEntry[]
    ): {
        isEqual: boolean;
        combinedSourcePermissions: Permission[];
        combinedTargetPermissions: Permission[];
    } {
        // Combine all permissions from multiple entries for the same principal
        const sourceCombined = this.combinePermissions(sourceEntries);
        const targetCombined = this.combinePermissions(targetEntries);
        
        const isEqual = this.arePermissionsEqual(sourceCombined, targetCombined);

        return {
            isEqual,
            combinedSourcePermissions: sourceCombined,
            combinedTargetPermissions: targetCombined
        };
    }

    private combinePermissions(entries: ACLEntry[]): Permission[] {
        const allPermissionCodes = new Set<string>();

        for (const entry of entries) {
            for (const perm of entry.permissions) {
                allPermissionCodes.add(perm.code);
            }
        }

        return Array.from(allPermissionCodes)
            .sort() // Sort for consistent comparison
            .map(code => ({
                code,
                description: PERMISSION_MAP[code] || code
            }));
    }
    private arePermissionsEqual(perms1: Permission[], perms2: Permission[]): boolean {
        // Filter out inheritance and non-settable flags for comparison
        const filterComparablePermissions = (perms: Permission[]) =>
            perms.filter(p => !NON_SETTABLE_FLAGS.includes(p.code) && !INHERITANCE_FLAGS.includes(p.code));

        const filtered1 = filterComparablePermissions(perms1);
        const filtered2 = filterComparablePermissions(perms2);

        if (filtered1.length !== filtered2.length) {
            return false;
        }

        // Sort permission codes for consistent comparison
        const codes1 = filtered1.map(p => p.code).sort();
        const codes2 = filtered2.map(p => p.code).sort();

        return codes1.every((code, index) => code === codes2[index]);
    }

    aclToOneLineString(acl?: { permissions?: any[] }): string {
        return (acl?.permissions ?? [])
            .map(entry => {
                const principal = entry.principal;
                const accessType = entry.accessType;
                const permissionCodes = (entry.permissions ?? []).map(p => p.code).join(',');
                return `${principal}:${accessType}:${permissionCodes}`;
            })
            .join('|');
    }
    async stampFileOwner({ sourcePath, targetPath, isIdentityMappingAvailable, jobRunId }: { sourcePath: string, targetPath: string, isIdentityMappingAvailable: boolean, jobRunId: string }): Promise<string | boolean> {
        try {
            const sourceOwner = await this.getFileOwner(sourcePath, isIdentityMappingAvailable, jobRunId);
            return await this.stampFileOwnerByName({ targetPath, ownerName: sourceOwner.owner });
        } catch (error) {
            this.logger.error(`Failed to stamp owner from ${sourcePath} to ${targetPath}:`, error);
            return `Failed to stamp owner , ${(error as Error).message}`;
        }
    }


    async getFileOwner(
        filePath: string,
        isIdentityMappingAvailable: boolean,
        jobRunId: string
    ): Promise<{ owner: string }> {
        const normalizedPath = path.resolve(filePath);

        // 1 Get raw owner via PowerShell
        const command = `
        powershell -Command "
        $acl = Get-Acl '${normalizedPath}';
        $cleanedOwner = $acl.Owner -replace '^O:', '';
        $acl.Owner
        "
    `;
        let stdout: string, stderr: string;
        try {
            ({ stdout, stderr } = await this.shellPool.executeCommand(command));
            stdout = stdout?.trim() || '';
            stderr = stderr?.trim() || '';

            if (stderr) throw new Error(stderr);
            if (!stdout) throw new Error(`Owner information is empty`);
        } catch (error: any) {
            this.logger.error(`Failed to get file owner for "${normalizedPath}": ${error.message}`, error);
            throw new Error(`Failed to get file owner for "${normalizedPath}": ${error.message}`);
        }

        const owner = stdout.split(/\r?\n/).map(l => l.trim()).find(Boolean);
        if (!owner) throw new Error(`Unable to determine owner for "${normalizedPath}"`);

        let resolvedOwner: string | null = null;

        // 2 If owner is a SID
        if (SID_REGEX.test(owner)) {
            try {
                const mapped = isIdentityMappingAvailable
                    ? await this.resolvePrincipal(owner, jobRunId)
                    : owner;

                if (!mapped || mapped === owner) {
                    throw new Error(`Cannot map SID "${owner}" to a valid username`);
                }

                resolvedOwner = SID_REGEX.test(mapped)
                    ? await this.getSidToOwner(mapped)
                    : mapped;

                if (!resolvedOwner) {
                    throw new Error(`No username found for SID "${mapped}"`);
                }
            } catch (error: any) {
                this.logger.error(`Failed to resolve SID "${owner}": ${error.message}`, error);
                throw new Error(`Failed to resolve SID "${owner}": ${error.message}`);
            }
        }
        // 3 If owner is a username
        else {
            try {
                const mapped = await this.resolvePrincipal(owner, jobRunId);

                // If mapping gave back the same username → try SID lookup
                if (mapped === owner) {
                    try {
                        const sidCmd = `
                        powershell -Command "
                        $nt = New-Object System.Security.Principal.NTAccount('${owner}');
                        $sid = $nt.Translate([System.Security.Principal.SecurityIdentifier]);
                        $sid.Value
                        "
                    `;
                        const { stdout: sidOut, stderr: sidErr } = await this.shellPool.executeCommand(sidCmd);

                        if (sidErr) throw new Error(sidErr);

                        const sid = sidOut?.split(/\r?\n/).map(l => l.trim()).find(Boolean);

                        if (sid && SID_REGEX.test(sid) && isIdentityMappingAvailable) {
                            const mappedSid = await this.resolvePrincipal(sid, jobRunId);
                            resolvedOwner = SID_REGEX.test(mappedSid)
                                ? await this.getSidToOwner(mappedSid)
                                : mappedSid;
                        } else {
                            resolvedOwner = owner; // keep original if no SID translation
                        }
                    } catch (sidError: any) {
                        throw new Error(`Failed to translate "${owner}" to SID: ${sidError.message}`);
                    }
                } else {
                    resolvedOwner = SID_REGEX.test(mapped)
                        ? await this.getSidToOwner(mapped)
                        : mapped;
                }
            } catch (error: any) {
                this.logger.error(`Failed to resolve owner "${owner}": ${error.message}`, error);
                throw new Error(`Failed to resolve owner "${owner}": ${error.message}`);
            }
        }

        // 4Final check
        if (!resolvedOwner) {
            throw new Error(`Unable to determine effective owner for "${normalizedPath}"`);
        }
        this.logger.debug(`Resolved owner for--> "${normalizedPath}": ${resolvedOwner}`);
        return { owner: resolvedOwner };
    }



    async stampFileOwnerByName({
        targetPath,
        ownerName,
    }: {
        targetPath: string;
        ownerName: string;
    }): Promise<string | boolean> {
        const command = `icacls "${targetPath}" /setowner "${ownerName}"`;

        try {
            const { stdout: rawStdout, stderr: rawStderr } = await this.shellPool.executeCommand(command);
            const stdout = rawStdout?.trim() || '';
            const stderr = rawStderr?.trim() || '';

            // Check for known error patterns in stdout
            const errorPatterns: { pattern: RegExp; message: string }[] = [
                { pattern: /No mapping between account names and security IDs was done/i, message: `No mapping found for owner ${ownerName}` },
                { pattern: /Access is denied/i, message: `Access denied when setting owner ${ownerName} for ${targetPath}` },
                { pattern: /The system cannot find the file specified/i, message: `File not found: ${targetPath}` },
                { pattern: /The security ID structure is invalid/i, message: `Invalid security ID structure for ${ownerName}` },
                { pattern: /The handle is invalid/i, message: `Invalid handle for ${targetPath}` },
                { pattern: /The filename, directory name, or volume label syntax is incorrect/i, message: `Invalid path syntax: ${targetPath}` },
                { pattern: /The network path was not found/i, message: `Network path not found: ${targetPath}` },
            ];

            for (const { pattern, message } of errorPatterns) {
                if (stdout.match(pattern)) {
                    this.logger.warn(message);
                    return `Failed to set owner ${ownerName}, ${message}`;
                }
            }

            //  Check stderr or general failure
            if (stderr || this.failedNumGt0(stdout)) {
                const msg = stderr || stdout;
                this.logger.error(`Failed to set owner using name ${ownerName}: ${msg}`);
                return `Failed to set owner ${ownerName}, ${msg}`;
            }

            this.logger.debug(`Successfully set owner for ${targetPath} to ${ownerName}`);
            return true;

        } catch (error: any) {
            this.logger.error(`Error executing command to set owner by name: ${error.message}`, error);
            return `Failed to set owner ${ownerName}, ${error.message}`;
        }
    }



    async getSidToOwner(sid: string): Promise<string> {
        if (!sid || !SID_REGEX.test(sid)) {
            throw new Error(`Invalid SID provided: "${sid}"`);
        }

        const command = `
    powershell -NoProfile -Command "
    try {
        $sidObj = New-Object System.Security.Principal.SecurityIdentifier('${sid}');
        $account = $sidObj.Translate([System.Security.Principal.NTAccount]);
        Write-Output $account.Value;
    } catch {
        Write-Error $_.Exception.Message;
        exit 1;
    }
    "`;

        try {
            const { stdout, stderr } = await this.shellPool.executeCommand(command);

            // Normalize line endings & trim
            const owner = stdout?.replace(/\r/g, '').trim();

            if (stderr?.trim()) {
                this.logger.error(`PowerShell error while resolving SID "${sid}": ${stderr}`);
                throw new Error(stderr.trim());
            }

            if (!owner) {
                this.logger.warn(`No username found for SID "${sid}"`);
                return '';
            }

            return owner;
        } catch (error) {
            this.logger.error(`Failed to resolve SID "${sid}": ${error.message}`, error);
            throw new Error(`Failed to get owner for SID "${sid}": ${error.message}`);
        }
    }

}