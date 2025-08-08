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
    valueParser?: (v: number) => number,
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
          Number(v.toFixed(4)),
        );
        break;

      case 'MEMORY_MB':
        headers = ['timestamp', 'namespace', 'pod', 'memory_mb'];
        // query already divides bytes → MB, just format decimals
        rows = this.convertPrometheusResultToRows(response, (v) =>
          Number(v.toFixed(4)),
        );
        break;

      case 'DISK_WRITE_BPS':
        headers = ['timestamp', 'namespace', 'pod', 'disk_write_bps'];
        // already in bytes/sec from Prometheus, just format
        rows = this.convertPrometheusResultToRows(response, (v) =>
          Number(v.toFixed(2)),
        );
        break;

      case 'DISK_READ_BPS':
        headers = ['timestamp', 'namespace', 'pod', 'disk_read_bps'];
        rows = this.convertPrometheusResultToRows(response, (v) =>
          Number(v.toFixed(2)),
        );
        break;

      case 'NETWORK_THROUGHPUT_KBPS':
        headers = ['timestamp', 'namespace', 'pod', 'network_bps'];
        // query already converts to kbps, just format
        rows = this.convertPrometheusResultToRows(response, (v) =>
          Number(v.toFixed(2)),
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
}
