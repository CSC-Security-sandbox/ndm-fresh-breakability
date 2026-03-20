export const DEFAULT_DIR_CONTENT_TTL_SECONDS = 86400; // 24 hours

export interface Options {
    preserveAccessTime?: boolean;
    preservePermissions?: boolean;
    excludeOlderThan?: string;
    excludeFilePattern?: string;
    skipsFilesModifiedInLast?: string;
    isIdentityMappingAvailable?: boolean;
    shouldScanADS?: boolean;
    dirContentTtlSeconds?: number;
}