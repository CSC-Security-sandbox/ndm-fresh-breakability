export interface Options {
    preserveAccessTime?: boolean;
    preservePermissions?: boolean;
    excludeOlderThan?: string;
    excludeFilePattern?: string;
    skipsFilesModifiedInLast?: string;
    isIdentityMappingAvailable?: boolean;
    shouldScanADS?: boolean;
}