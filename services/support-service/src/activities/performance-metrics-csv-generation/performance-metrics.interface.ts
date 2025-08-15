import PERFORMANCE_METRICS_QUERIES from './performance-metrics.constants';

export type PerformanceMetricName = keyof typeof PERFORMANCE_METRICS_QUERIES;

export interface ProcessedMetricResult {
  /**
   * Parsed table data for the metric, ready for CSV generation.
   * Each row contains timestamp and metric-specific fields
   */
  data:
    | Array<[string, string, string, number]>
    | Array<[string, string, string, string, number]>
    | any[];

  /**
   * CSV string containing headers + rows.
   */
  csvContent: string;
}

export type ProcessedMetricsBatchResult = {
  [metric in PerformanceMetricName]?: ProcessedMetricResult;
};
