import { Injectable, Logger } from '@nestjs/common';
import { PrometheusClientService } from 'src/prometheus/prometheus-client.service';
import PERFORMANCE_METRICS_QUERIES from './performance-metrics.constants';
import { PerformanceMetricsProcessorService } from './performance-metrics-processor.service';
import { ProcessedMetricsBatchResult } from './performance-metrics.interface';
import { ZipHandlerService } from 'src/services/zip-handler.service';

@Injectable()
export class PerformanceMetricsCsvGenerationActivity {
  private readonly logger = new Logger(
    PerformanceMetricsCsvGenerationActivity.name,
  );

  constructor(
    private readonly prometheusClient: PrometheusClientService,
    private readonly processorService: PerformanceMetricsProcessorService,
    private readonly zipHandler: ZipHandlerService,
  ) {}

  async generatePerformanceMetricsCsv({
    traceId,
    payload,
  }: {
    traceId: string;
    payload: any;
  }) {
    this.logger.log(`[${traceId}] Starting Performance metrics CSV generation`);

    const queries = Object.entries(PERFORMANCE_METRICS_QUERIES);

    const results = await Promise.allSettled(
      queries.map(async ([metric, queryConfig]) => {
        const response = await this.prometheusClient.callPrometheusApi(
          queryConfig.query,
          payload.startDate as string,
          payload.endDate as string,
          queryConfig.step,
        );
        return { metric, response };
      }),
    );

    const extractedResults = this.extractSuccessfulResults(results);

    const processedResults =
      await this.processorService.processBatchMetrics(extractedResults);

    await this.generateCsvFiles(
      traceId,
      processedResults,
      payload.zipLocation as string,
    );

    this.logger.log(
      `[${traceId}] Performance metrics CSV generation completed successfully`,
    );

    return 'Performance metrics CSV generation completed successfully';
  }

  private extractSuccessfulResults(results: any[]): any[] {
    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      const queryName = Object.keys(PERFORMANCE_METRICS_QUERIES)[index];
      this.logger.warn(
        `Failed to fetch ${queryName}: ${result.reason.message}`,
      );
      return null;
    });
  }

  private async generateCsvFiles(
    traceId: string,
    data: ProcessedMetricsBatchResult,
    zipLocation: string,
  ) {
    const timestamp = Date.now();

    if (data?.CPU_PERCENT && data.CPU_PERCENT?.data?.length > 0) {
      const fileName = `Performance metrics/cpu_percent_${timestamp}.csv`;
      await this.zipHandler.addCsvToZip(
        data.CPU_PERCENT.csvContent,
        fileName,
        zipLocation,
      );
      this.logger.log(`[${traceId}] CPU Percent CSV created: ${fileName}`);
    }

    if (data.MEMORY_MB && data.MEMORY_MB?.data?.length > 0) {
      const fileName = `Performance metrics/memory_mb_${timestamp}.csv`;
      await this.zipHandler.addCsvToZip(
        data.MEMORY_MB.csvContent,
        fileName,
        zipLocation,
      );
      this.logger.log(`[${traceId}] Memory CSV created: ${fileName}`);
    }

    if (data.DISK_READ_BPS && data.DISK_READ_BPS?.data?.length > 0) {
      const fileName = `Performance metrics/disk_read_bps_${timestamp}.csv`;
      await this.zipHandler.addCsvToZip(
        data.DISK_READ_BPS.csvContent,
        fileName,
        zipLocation,
      );
      this.logger.log(`[${traceId}] Disk Read BPS CSV created: ${fileName}`);
    }

    if (data.DISK_WRITE_BPS && data.DISK_WRITE_BPS?.data?.length > 0) {
      const fileName = `Performance metrics/disk_write_bps_${timestamp}.csv`;
      await this.zipHandler.addCsvToZip(
        data.DISK_WRITE_BPS.csvContent,
        fileName,
        zipLocation,
      );
      this.logger.log(`[${traceId}] Disk Write BPS CSV created: ${fileName}`);
    }

    if (
      data.NETWORK_THROUGHPUT_BPS &&
      data.NETWORK_THROUGHPUT_BPS?.data?.length > 0
    ) {
      const fileName = `Performance metrics/network_throughput_bps_${timestamp}.csv`;
      await this.zipHandler.addCsvToZip(
        data.NETWORK_THROUGHPUT_BPS.csvContent,
        fileName,
        zipLocation,
      );
      this.logger.log(
        `[${traceId}] Network Throughput BPS CSV created: ${fileName}`,
      );
    }

    // Generate separate CSV files for each service metric
    if (
      data.SERVICE_REQUEST_RATE &&
      data.SERVICE_REQUEST_RATE?.data?.length > 0
    ) {
      const fileName = `Performance metrics/service_request_rate_${timestamp}.csv`;
      await this.zipHandler.addCsvToZip(
        data.SERVICE_REQUEST_RATE.csvContent,
        fileName,
        zipLocation,
      );
      this.logger.log(
        `[${traceId}] Service Request Rate CSV created: ${fileName}`,
      );
    }

    if (
      data.SERVICE_LATENCY_P95 &&
      data.SERVICE_LATENCY_P95?.data?.length > 0
    ) {
      const fileName = `Performance metrics/service_latency_p95_${timestamp}.csv`;
      await this.zipHandler.addCsvToZip(
        data.SERVICE_LATENCY_P95.csvContent,
        fileName,
        zipLocation,
      );
      this.logger.log(
        `[${traceId}] Service Latency P95 CSV created: ${fileName}`,
      );
    }

    if (data.CLIENT_ERROR_RATE && data.CLIENT_ERROR_RATE?.data?.length > 0) {
      const fileName = `Performance metrics/client_error_rate_${timestamp}.csv`;
      await this.zipHandler.addCsvToZip(
        data.CLIENT_ERROR_RATE.csvContent,
        fileName,
        zipLocation,
      );
      this.logger.log(
        `[${traceId}] Client Error Rate CSV created: ${fileName}`,
      );
    }

    if (
      data.SERVICE_ERROR_RATE_BY_TYPE &&
      data.SERVICE_ERROR_RATE_BY_TYPE?.data?.length > 0
    ) {
      const fileName = `Performance metrics/service_error_rate_by_type_${timestamp}.csv`;
      await this.zipHandler.addCsvToZip(
        data.SERVICE_ERROR_RATE_BY_TYPE.csvContent,
        fileName,
        zipLocation,
      );
      this.logger.log(
        `[${traceId}] Service Error Rate by Type CSV created: ${fileName}`,
      );
    }
  }
}
