export interface Options {
    preserveAccessTime?: boolean;
    excludeOlderThan?: string;
    excludeFilePattern?: string;
    skipsFilesModifiedInLast?: string;
    isIdentityMappingAvailable?: boolean;
    shouldScanADS?: boolean;
}