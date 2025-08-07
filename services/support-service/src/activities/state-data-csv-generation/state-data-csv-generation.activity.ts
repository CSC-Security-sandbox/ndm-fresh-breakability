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

    const data = await this.prometheusDataProcessor.getPrometheusMetrics(
      payload.startDate as string,
      payload.endDate as string,
    );

    this.logger.log(`[${traceId}] Retrieved metrics data`, {
      servicePods: data.servicePods?.length || 0,
      allMetrics: data.allMetrics?.length || 0,
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
  }
}
