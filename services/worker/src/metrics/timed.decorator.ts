/**
 * Method decorator that runs the method inside MetricsService.runWithTiming.
 * First argument of the decorated method must be an object that contains
 * jobRunId (or jobContext.jobRunId) so the decorator can extract workflow_id.
 *
 * Usage:
 *   @Timed('file_copy')
 *   async migrateWorkerThread(params: { jobRunId: string }) { ... }
 *
 *   @Timed({ category: 'stamp_phase', phase: 'acl' })
 *   async stampObjectACL(input: CommandExecInput) { ... }
 */

/** Metric or spec accepted by runWithTiming. */
export type RunWithTimingMetricOrSpec =
  | string
  | { category: string; phase: string };

function getJobRunIdFromArgs(args: unknown[]): string {
  const first = args[0];
  if (first == null || typeof first !== 'object') return 'unknown';
  const o = first as { jobRunId?: string; jobContext?: { jobRunId?: string } };
  const id = o.jobRunId ?? o.jobContext?.jobRunId ?? '';
  return typeof id === 'string' && id.trim() ? id.trim() : 'unknown';
}

export function Timed(metricOrSpec: RunWithTimingMetricOrSpec) {
  return function (
    _target: object,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const original = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    descriptor.value = async function (
      this: {
        metricsService: {
          runWithTiming: (
            a: string,
            b: RunWithTimingMetricOrSpec,
            c: () => Promise<unknown>,
          ) => Promise<unknown>;
        };
      },
      ...args: unknown[]
    ) {
      const jobRunId = getJobRunIdFromArgs(args);
      const metricsService = this.metricsService;

      if (!metricsService?.runWithTiming) {
        return original.apply(this, args);
      }
      return metricsService.runWithTiming(jobRunId, metricOrSpec, () =>
        original.apply(this, args),
      );
    };
    return descriptor;
  };
}
