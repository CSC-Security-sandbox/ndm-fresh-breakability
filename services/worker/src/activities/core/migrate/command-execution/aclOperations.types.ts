export interface Permission {
    code: string;
    description: string;
}

export interface ACLEntry {
    principal: string;
    originalPrincipal?: string;
    permissions: Permission[];
    accessType: 'allow' | 'deny';
}

export interface ACLData {
    filePath: string;
    timestamp: string;
    user: string;
    permissions: ACLEntry[];
    inheritance: string | null;
}

export interface Operation {
    type: 'reset' | 'grant' | 'deny' | 'skip';
    principal?: string;
    permissions?: string;
    status: 'completed' | 'failed' | 'skipped';
    reason?: string;
    error?: string;
}

export interface StampResult {
    source: string;
    target: string;
    timestamp: string;
    user: string;
    operations: Operation[];
    commands: string[];
    success: boolean;
}

export interface StampOptions {
    preserveExisting?: boolean;
    excludePrincipals?: string[];
    includePrincipals?: string[];
    resolveSIDs?: boolean;
    isIdentityMappingAvailable?: boolean;
    jobID?: string;
}

export interface GetACLOptions {
    resolveSIDs?: boolean;
    isIdentityMappingAvailable?: boolean;
    jobID?: string;
}

export interface ParsedACL {
    permissions: ACLEntry[];
    inheritance: string | null;
}

export interface ComparisonResult {
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

// Redis service interface
export interface RedisService {
    getOwnerIdentity(jobID: string, sid: string, type: 'SID'): Promise<string | null>;
}

// Exported ACL type for external use
export interface ExportedACL {
    version: string;
    source: string;
    exportDate: string;
    acl: ACLData;
}
