/**
 * Upgrade bundle distribution status for a worker
 */
export enum UpgradeBundleStatus {
    /** No upgrade bundle distribution initiated */
    IDLE = 'IDLE',
    /** Multicast triggered, worker download in progress */
    IN_PROGRESS = 'IN_PROGRESS',
    /** Worker downloaded and verified successfully */
    COMPLETED = 'COMPLETED',
    /** Worker download failed */
    FAILED = 'FAILED',
  }

/**
 * Upgrade execution status for a worker.
 * Tracks whether the worker has applied the staged binary.
 */
export enum UpgradeExecutionStatus {
    /** No upgrade execution initiated */
    IDLE = 'IDLE',
    /** Upgrade script triggered on worker */
    IN_PROGRESS = 'IN_PROGRESS',
    /** Worker rebooted and sent ACK with new version */
    COMPLETED = 'COMPLETED',
    /** Upgrade execution failed or timed out */
    FAILED = 'FAILED',
  }