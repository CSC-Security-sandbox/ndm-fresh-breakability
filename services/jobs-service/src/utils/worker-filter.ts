import { WorkerEntity } from 'src/entities/worker.entity';
import { HealthStatus } from 'src/workers/worker.types';

/**
 *
 * @param worker with worker stats
 * @param timeout in seconds
 * @returns true if the worker is healthy or the time since the last update is less than the timeout
 */
export function filterUnhealthyWorkers(
  worker: WorkerEntity,
  timeout: number,
): boolean {
  const timeDiffInSec = Math.floor(
    Math.abs(new Date().getTime() - worker.stats?.updatedAt.getTime()) / 1000,
  );
  return (
    worker.stats?.healthStatus === HealthStatus.Healthy &&
    timeDiffInSec < timeout
  );
}
