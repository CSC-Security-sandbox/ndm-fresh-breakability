/**
 * Upgrade Workflow Types
 * 
 * Types and interfaces for the binary multicast workflow.
 * 
 * Flow:
 *   1st API (POST /multicast) → BinaryMulticastWorkflow → WorkerDownloadWorkflow
 *                                                              ↓
 *                                                         downloadBinary()
 *                                                              ↓
 *                                                         2nd API (GET /worker/:platform)
 * 
 * Note:
 *   - Binaries are already extracted on CP at /upgrade/worker/{platform}/
 *   - Worker downloads the binary file directly (not archive)
 *   - Binary names: datamigrator-{version} (linux) or datamigrator-{version}.exe (windows)
 */

// =============================================================================
// 1st API Input (POST /api/v1/upgrade/multicast)
// =============================================================================

export interface MulticastApiInput {
  /** Worker IDs to distribute binaries to, or 'all' for all workers */
  workerIds: string[] | 'all';
  /** Target version being distributed */
  version: string;
}

export interface MulticastApiOutput {
  /** Workflow ID for tracking */
  workflowId: string;
  /** Status */
  status: 'started' | 'error';
  /** Message */
  message?: string;
}

// =============================================================================
// Binary Multicast Workflow Types (Parent Workflow)
// =============================================================================

export interface BinaryMulticastWorkflowInput {
  /** Unique trace ID for logging */
  traceId: string;
  /** Worker IDs to distribute to */
  workerIds: string[];
  /** Target version */
  version: string;
}

export interface BinaryMulticastWorkflowOutput {
  /** Trace ID */
  traceId: string;
  /** Overall status */
  status: 'completed' | 'partial' | 'failed';
  /** Summary counts */
  summary: {
    total: number;
    success: number;
    failed: number;
  };
  /** Per-worker results */
  results: WorkerDownloadResult[];
}

// =============================================================================
// Worker Download Workflow Types (Child Workflow - runs on worker)
// =============================================================================

export interface WorkerDownloadWorkflowInput {
  /** Trace ID for logging */
  traceId: string;
  /** This worker's ID */
  workerId: string;
  /** Target version */
  version: string;
}

export interface WorkerDownloadWorkflowOutput {
  /** Worker ID */
  workerId: string;
  /** Detected platform */
  platform?: 'linux' | 'windows';
  /** Status */
  status: 'success' | 'failed';
  /** Message (error message if failed) */
  message?: string;
  /** Path where binary was staged */
  stagedPath?: string;
  /** File size in bytes */
  sizeBytes?: number;
}

// =============================================================================
// Activity Types (downloadBinary, stageBinary)
// =============================================================================

export interface DownloadBinaryInput {
  /** Full URL to download from */
  downloadUrl: string;
  /** Platform */
  platform: 'linux' | 'windows';
  /** Target version */
  version: string;
  /** Auth token for CP */
  authToken?: string;
}

export interface DownloadBinaryOutput {
  /** Path where file was downloaded */
  downloadedPath: string;
  /** File size in bytes */
  sizeBytes: number;
}

export interface StageBinaryInput {
  /** Source path (downloaded file) */
  sourcePath: string;
  /** Platform */
  platform: 'linux' | 'windows';
  /** Version */
  version: string;
}

export interface StageBinaryOutput {
  /** Final staged path */
  stagedPath: string;
}

export interface DownloadEnvInput {
  /** Full URL to download env file from */
  downloadUrl: string;
  /** Platform */
  platform: 'linux' | 'windows';
  /** Auth token for CP */
  authToken?: string;
}

export interface DownloadEnvOutput {
  /** Path where env file was downloaded */
  downloadedPath: string;
  /** File size in bytes */
  sizeBytes: number;
}

// =============================================================================
// Worker Download Result (used in workflow output)
// =============================================================================

export interface WorkerDownloadResult {
  /** Worker ID */
  workerId: string;
  /** Platform */
  platform: 'linux' | 'windows';
  /** Status */
  status: 'success' | 'failed';
  /** Message */
  message?: string;
  /** Staged path (if success) */
  stagedPath?: string;
  /** Timestamp */
  timestamp: string;
}

// =============================================================================
// Worker Info (for getting worker list)
// =============================================================================

export interface WorkerInfo {
  /** Worker ID (UUID) */
  workerId: string;
  /** Platform */
  platform: 'linux' | 'windows';
  /** Task queue name (e.g., "worker-123-TaskQueue") */
  taskQueue: string;
  /** Current worker version */
  currentVersion?: string;
  /** Worker status */
  status: 'online' | 'offline';
}

// =============================================================================
// Multicast Status (for tracking in DB if needed)
// =============================================================================

export enum MulticastStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// =============================================================================
// Constants
// =============================================================================

/**
 * API endpoints on CP for downloading binaries and env
 * Worker calls: GET {cpBaseUrl}{endpoint}
 */
export const UPGRADE_ENDPOINTS = {
  /** Endpoint for Linux binary */
  linux: '/api/v1/upgrade/worker/linux',
  /** Endpoint for Windows binary */
  windows: '/api/v1/upgrade/worker/windows',
  /** Endpoint for common env file */
  env: '/api/v1/upgrade/worker/env',
} as const;

/**
 * Paths on CP where binaries are stored (after upload & extraction)
 * Admin-service serves files from these paths
 */
export const CP_BINARY_PATHS = {
  /** Linux binary path on CP */
  linux: '/upgrade/worker/linux',
  /** Windows binary path on CP */
  windows: '/upgrade/worker/windows',
} as const;

/**
 * Paths on Worker where binaries and env are staged/stored
 */
export const WORKER_PATHS = {
  linux: {
    /** Directory to stage downloaded binaries */
    stagingDir: '/opt/datamigrator/staging',
    /** Directory where current binary lives */
    binaryDir: '/opt/datamigrator/binary',
    /** Binary name pattern */
    binaryName: 'datamigrator-worker',
    /** Env file name */
    envFileName: '.env',
  },
  windows: {
    /** Directory to stage downloaded binaries */
    stagingDir: 'C:\\datamigrator\\staging',
    /** Directory where current binary lives */
    binaryDir: 'C:\\datamigrator\\binary',
    /** Binary name pattern */
    binaryName: 'datamigrator-worker.exe',
    /** Env file name */
    envFileName: '.env',
  },
} as const;
