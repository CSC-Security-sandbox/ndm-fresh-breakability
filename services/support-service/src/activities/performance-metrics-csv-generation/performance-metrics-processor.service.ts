import { Injectable, Logger } from '@nestjs/common';
import { writeToString } from 'fast-csv';
import { PrometheusResponse } from 'src/prometheus/prometheus.interface';
import {
  PerformanceMetricName,
  ProcessedMetricResult,
  ProcessedMetricsBatchResult,
} from './performance-metrics.interface';

@Injectable()
export class PerformanceMetricsProcessorService {
  private readonly logger = new Logger(PerformanceMetricsProcessorService.name);

  private async generateCsvContent(
    headers: string[] | false,
    rows: any[][],
  ): Promise<string> {
    return await writeToString(rows, { headers });
  }

  /**
   * Converts Prometheus response result into rows for CSV
   * @param valueParser optional function to convert raw values (e.g., bytes → GB)
   */
  private convertPrometheusResultToRows(
    response: PrometheusResponse,
    valueParser?: (v: number) => number | string,
  ): any[][] {
    if (!response.data || !response.data.result) return [];

    const rows: any[][] = [];
    for (const metricData of response.data.result) {
      const namespace = metricData.metric?.namespace || '';
      const pod = metricData.metric?.pod || '';

      for (const [timestamp, value] of metricData.values || []) {
        const numericValue = Number(value);
        rows.push([
          new Date(Number(timestamp) * 1000).toISOString(), // ISO timestamp
          namespace,
          pod,
          valueParser ? valueParser(numericValue) : numericValue,
        ]);
      }
    }
    return rows;
  }

  /**
   * Convert Prometheus result to rows for service-level metrics
   */
  private convertServiceMetricResultToRows(
    response: PrometheusResponse,
    labelFields: string[],
    valueParser?: (v: number) => number | string,
  ): any[][] {
    if (!response.data || !response.data.result) return [];

    const rows: any[][] = [];
    for (const metricData of response.data.result) {
      // Extract label values in the order specified by labelFields
      const labelValues = labelFields.map(
        (field) => metricData.metric?.[field] || '',
      );

      for (const [timestamp, value] of metricData.values || []) {
        const numericValue = Number(value);
        rows.push([
          new Date(Number(timestamp) * 1000).toISOString(), // ISO timestamp
          ...labelValues,
          valueParser ? valueParser(numericValue) : numericValue,
        ]);
      }
    }
    return rows;
  }

  /**
   * Process a single metric into CSV data
   */
  async processMetricData(metric: string, response: PrometheusResponse) {
    if (!response || !response.data || !response.data.result) {
      return { data: null, csvContent: '' };
    }

    let headers: string[] = [];
    let rows: any[][] = [];

    switch (metric) {
      case 'CPU_PERCENT':
        headers = ['timestamp', 'namespace', 'pod', 'cpu_%'];
        // value is already in cores from Prometheus query
        rows = this.convertPrometheusResultToRows(response, (v) =>
          isNaN(v) ? 'NaN' : Number(v.toFixed(4)),
        );
        break;

      case 'MEMORY_MB':
        headers = ['timestamp', 'namespace', 'pod', 'memory_mb'];
        // query already divides bytes → MB, just format decimals
        rows = this.convertPrometheusResultToRows(response, (v) =>
          isNaN(v) ? 'NaN' : Number(v.toFixed(4)),
        );
        break;

      case 'DISK_WRITE_BPS':
        headers = ['timestamp', 'namespace', 'pod', 'disk_write_bps'];
        // already in bytes/sec from Prometheus, just format
        rows = this.convertPrometheusResultToRows(response, (v) =>
          isNaN(v) ? 'NaN' : Number(v.toFixed(2)),
        );
        break;

      case 'DISK_READ_BPS':
        headers = ['timestamp', 'namespace', 'pod', 'disk_read_bps'];
        rows = this.convertPrometheusResultToRows(response, (v) =>
          isNaN(v) ? 'NaN' : Number(v.toFixed(2)),
        );
        break;

      case 'NETWORK_THROUGHPUT_KBPS':
        headers = ['timestamp', 'namespace', 'pod', 'network_bps'];
        // query already converts to kbps, just format
        rows = this.convertPrometheusResultToRows(response, (v) =>
          isNaN(v) ? 'NaN' : Number(v.toFixed(2)),
        );
        break;

      case 'SERVICE_REQUEST_RATE':
        headers = ['timestamp', 'operation', 'service_name', 'request_rate'];
        rows = this.convertServiceMetricResultToRows(
          response,
          ['operation', 'service_name'],
          (v) => (isNaN(v) ? 'NaN' : Number(v.toFixed(4))),
        );
        break;

      case 'SERVICE_LATENCY_P95':
        headers = ['timestamp', 'operation', 'service_name', 'latency_p95_ms'];
        rows = this.convertServiceMetricResultToRows(
          response,
          ['operation', 'service_name'],
          (v) => (isNaN(v) ? 'NaN' : Number(v.toFixed(2))),
        );
        break;

      case 'CLIENT_ERROR_RATE':
        headers = [
          'timestamp',
          'service_name',
          'service_role',
          'client_error_rate',
        ];
        rows = this.convertServiceMetricResultToRows(
          response,
          ['service_name', 'service_role'],
          (v) => (isNaN(v) ? 'NaN' : Number(v.toFixed(4))),
        );
        break;

      case 'SERVICE_ERROR_RATE_BY_TYPE':
        headers = ['timestamp', 'service_name', 'error_type', 'error_rate'];
        rows = this.convertServiceMetricResultToRows(
          response,
          ['service_name', 'error_type'],
          (v) => (isNaN(v) ? 'NaN' : Number(v.toFixed(4))),
        );
        break;

      default:
        this.logger.warn(`No CSV mapping found for metric: ${metric}`);
        return { data: null, csvContent: '' };
    }

    const csvContent = await this.generateCsvContent(headers, rows);
    return { data: rows, csvContent };
  }

  /**
   * Process multiple metrics at once
   */
  async processBatchMetrics(
    metricsData: Array<{
      metric: PerformanceMetricName;
      response: PrometheusResponse;
    }>,
  ): Promise<ProcessedMetricsBatchResult> {
    const processedResults: ProcessedMetricsBatchResult = {};

    for (const { metric, response } of metricsData) {
      const result = await this.processMetricData(metric, response);
      if (result.data !== null) {
        processedResults[metric] = result as ProcessedMetricResult;
      }
    }

    return processedResults;
  }

  /**
   * Combine service metrics into a single CSV with all metrics as columns
   */
  async createCombinedServiceMetricsCsv(
    processedResults: ProcessedMetricsBatchResult,
  ): Promise<{ csvContent: string; hasData: boolean }> {
    const serviceMetrics = [
      'SERVICE_REQUEST_RATE',
      'SERVICE_LATENCY_P95',
      'CLIENT_ERROR_RATE',
      'SERVICE_ERROR_RATE_BY_TYPE',
    ] as const;

    // Check if we have any service metrics data
    const availableServiceMetrics = serviceMetrics.filter(
      (metric) =>
        processedResults[metric] && processedResults[metric]!.data?.length > 0,
    );

    if (availableServiceMetrics.length === 0) {
      return { csvContent: '', hasData: false };
    }

    // Create combined rows - each row will have all available metrics for that specific data point
    const allRows: any[][] = [];

    // Process each service metric and add its data
    for (const metric of availableServiceMetrics) {
      const data = processedResults[metric]?.data;
      if (!data) continue;

      for (const row of data) {
        const [timestamp, operation, service_name, service_role, ...rest] = row;

        let error_type = '';
        let value: number;
        let metricRow: any[];

        // For SERVICE_ERROR_RATE_BY_TYPE, error_type is the 4th element, value is 5th
        if (metric === 'SERVICE_ERROR_RATE_BY_TYPE' && rest.length > 1) {
          error_type = String((rest as any[])[0] ?? '');
          value = Number((rest as any[])[1] ?? 0);
        } else if (rest.length > 0) {
          value = Number((rest as any[])[0] ?? 0);
        } else {
          value = 0;
        }

        // Create a row with the appropriate metric populated
        switch (metric) {
          case 'SERVICE_REQUEST_RATE':
            metricRow = [
              String(timestamp),
              String(operation),
              String(service_name),
              String(service_role),
              '',
              value, // request_rate
              '', // latency_p95_ms
              '', // client_error_rate
              '', // service_error_rate
            ];
            break;
          case 'SERVICE_LATENCY_P95':
            metricRow = [
              String(timestamp),
              String(operation),
              String(service_name),
              String(service_role),
              '',
              '', // request_rate
              value, // latency_p95_ms
              '', // client_error_rate
              '', // service_error_rate
            ];
            break;
          case 'CLIENT_ERROR_RATE':
            metricRow = [
              String(timestamp),
              String(operation),
              String(service_name),
              String(service_role),
              '',
              '', // request_rate
              '', // latency_p95_ms
              value, // client_error_rate
              '', // service_error_rate
            ];
            break;
          case 'SERVICE_ERROR_RATE_BY_TYPE':
            metricRow = [
              String(timestamp),
              String(operation),
              String(service_name),
              String(service_role),
              error_type,
              '', // request_rate
              '', // latency_p95_ms
              '', // client_error_rate
              value, // service_error_rate
            ];
            break;
          default:
            continue;
        }

        allRows.push(metricRow);
      }
    }

    // Sort rows by timestamp for better readability
    allRows.sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());

    // Headers for the combined CSV
    const headers = [
      'timestamp',
      'operation',
      'service_name',
      'service_role',
      'error_type',
      'request_rate',
      'latency_p95_ms',
      'client_error_rate',
      'service_error_rate',
    ];

    const csvContent = await this.generateCsvContent(headers, allRows);
    return { csvContent, hasData: true };
  }
}
