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