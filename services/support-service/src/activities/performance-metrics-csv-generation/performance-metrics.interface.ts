import PERFORMANCE_METRICS_QUERIES from './performance-metrics.constants';

export type PerformanceMetricName = keyof typeof PERFORMANCE_METRICS_QUERIES;

export interface ProcessedMetricResult {
  /**
   * Parsed table data for the metric, ready for CSV generation.
   * Each row: [timestamp, namespace, pod, value]
   */
  data: Array<[string, string, string, number]>;

  /**
   * CSV string containing headers + rows.
   */
  csvContent: string;
}

export type ProcessedMetricsBatchResult = {
  [metric in PerformanceMetricName]?: ProcessedMetricResult;
};
