import { Injectable, Logger } from '@nestjs/common';
import { PrometheusDataProcessorService } from 'src/prometheus/prometheus-data-processor.service';
import { CsvGeneratorService } from 'src/services/csv-generator.service';
import { ZipHandlerService } from 'src/services/zip-handler.service';
import { PrometheusMetrics } from './state-data-csv-generation.interface';

@Injectable()
export class StateDataCsvGenerationActivity {
  private readonly logger = new Logger(StateDataCsvGenerationActivity.name);

  constructor(
    private readonly prometheusDataProcessor: PrometheusDataProcessorService,
    private readonly csvGenerator: CsvGeneratorService,
    private readonly zipHandler: ZipHandlerService,
  ) {}

  async generateStateDataCsv({
    traceId,
    payload,
  }: {
    traceId: string;
    payload: any;
  }) {
    this.logger.log(`[${traceId}] Starting State Data CSV generation`);

    const workerIds =
      payload?.projectWorkerMap
        ?.filter((item: any) => Array.isArray(item.workerIds))
        ?.flatMap((item: any) => item.workerIds) || [];
    this.logger.log(
      `[${traceId}] Worker IDs provided: ${workerIds.length > 0 ? workerIds.join(', ') : 'None'}`,
    );

    // Check if State Data is requested in otherMetrics
    if (!payload?.otherMetrics?.includes('State Data')) {
      this.logger.log(
        `[${traceId}] State Data not requested in otherMetrics, skipping`,
      );
      return 'State Data CSV generation skipped - not requested';
    }

    const data = await this.prometheusDataProcessor.getPrometheusMetrics(
      payload?.startDate as string,
      payload?.endDate as string,
      workerIds as string[],
    );

    this.logger.log(`[${traceId}] Retrieved metrics data`, {
      servicePods: data.servicePods?.length || 0,
      allMetrics: data.allMetrics?.length || 0,
      buildDetails: data.buildDetails?.length || 0,
    });

    await this.generateCsvFiles(traceId, data, payload.zipLocation as string);

    this.logger.log(
      `[${traceId}] State Data CSV generation completed successfully`,
    );
    return 'State Data CSV generation completed successfully';
  }

  private async generateCsvFiles(
    traceId: string,
    data: PrometheusMetrics,
    zipLocation: string,
  ) {
    const timestamp = Date.now();

    if (data.servicePods && data.servicePods.length > 0) {
      const csvContent = this.csvGenerator.createServicePodsCsvContent(
        data.servicePods,
      );
      const fileName = `service_pods_${timestamp}.csv`;
      await this.zipHandler.addCsvToZip(csvContent, fileName, zipLocation);
      this.logger.log(`[${traceId}] Service pods CSV created: ${fileName}`);
    }

    if (data.allMetrics && data.allMetrics.length > 0) {
      const csvContent = this.csvGenerator.createMetricsCsvContent(
        data.allMetrics,
      );
      const fileName = `metrics_data_${timestamp}.csv`;
      await this.zipHandler.addCsvToZip(csvContent, fileName, zipLocation);
      this.logger.log(`[${traceId}] Metrics CSV created: ${fileName}`);
    }

    if (data.buildDetails && data.buildDetails.length > 0) {
      const csvContent = this.csvGenerator.createBuildDetailsCsvContent(
        data.buildDetails,
      );
      const fileName = `build_details_${timestamp}.csv`;
      await this.zipHandler.addCsvToZip(csvContent, fileName, zipLocation);
      this.logger.log(`[${traceId}] Build details CSV created: ${fileName}`);
    }
  }
}
