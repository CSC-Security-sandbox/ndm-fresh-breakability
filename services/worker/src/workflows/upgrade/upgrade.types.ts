/**
 * Upgrade Workflow Types
 * 
 * Types and interfaces for the binary multicast workflow.
 * 
 * Flow:
 *   1st API (POST /multicast) → BinaryMulticastWorkflow → WorkerDownloadWorkflow
 *                                                              ↓
 *                                                         downloadBundle()
 *                                                              ↓
 *                                                         2nd API (GET /worker/:version/:platform)
 * 
 * Note:
 *   - Bundles are stored on CP at /upgrade/{version}/worker/{platform}/
 *   - Each bundle (tar.gz for linux, zip for windows) contains: binary + env + checksums
 *   - Worker downloads one file, extracts everything to staging/{version}/
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
  /** Path where bundle was staged */
  stagedPath?: string;
  /** Bundle file size in bytes */
  sizeBytes?: number;
}

// =============================================================================
// Activity Types
// =============================================================================

export interface DownloadBundleInput {
  /** Target version */
  version: string;
}

export interface DownloadBundleOutput {
  /** Versioned staging directory path */
  stagedPath: string;
  /** Bundle file size in bytes */
  sizeBytes: number;
  /** Detected platform */
  platform: 'linux' | 'windows';
  /** Path to extracted binary */
  binaryPath: string;
  /** Path to extracted env file */
  envPath: string;
  /** Path to extracted upgrade script */
  upgradeScriptPath: string;
}

// =============================================================================
// Worker Download Result (used in workflow output)
// =============================================================================

export interface WorkerDownloadResult {
  /** Worker ID */
  workerId: string;
  /** Platform (may be absent if workflow failed before detection) */
  platform?: 'linux' | 'windows';
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
// Constants (used by admin-service for CP-side path building)
// Worker-side constants live in the handler classes.
// =============================================================================

/**
 * Base path on CP where upgrade bundles are stored.
 * Structure: /upgrade/{version}/worker/{platform}/
 */
export const CP_UPGRADE_BASE = '/upgrade';

/**
 * Build versioned path on CP for a specific version and platform.
 * e.g. /upgrade/2026.02.10185052-nightly/worker/linux/
 */
export const cpBundlePath = (version: string, platform: 'linux' | 'windows') =>
  `${CP_UPGRADE_BASE}/${version}/worker/${platform}`;
