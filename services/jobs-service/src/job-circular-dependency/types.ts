/**
 * Configuration for checking circular dependencies in a single migrate config
 */
export interface CircularDependencyCheckConfig {
    sourcePathId: string;
    destinationPathId: string[];
}

/**
 * Data structure containing multiple migrate configurations to check for circular dependencies
 */
export interface CircularDependencyCheckData {
    migrateConfigs: CircularDependencyCheckConfig[];
}

/**
 * Response structure for circular dependency validation
 */
export interface CircularDependencyValidationResult {
    hasErrors: boolean;
    dependencies?: any[];
    message?: string;
}
