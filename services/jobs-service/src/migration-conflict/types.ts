/**
 * Configuration for checking migration conflicts in a single migrate config
 */
export interface MigrationConflictCheckConfig {
    sourcePathId: string;
    destinationPathId: string[];
}

/**
 * Data structure containing multiple migrate configurations to check for migration conflicts
 */
export interface MigrationConflictCheckData {
    migrateConfigs: MigrationConflictCheckConfig[];
}

/**
 * Response structure for migration conflict validation
 */
export interface MigrationConflictValidationResult {
    hasErrors: boolean;
    dependencies?: any[];
    message?: string;
}
