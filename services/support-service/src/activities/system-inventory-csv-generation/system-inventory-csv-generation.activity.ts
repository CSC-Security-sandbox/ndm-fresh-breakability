import { Injectable, Logger } from '@nestjs/common';
import SYS_INV_SPECS_QUERIES from './system-inventory.constants';
import { PrometheusClientService } from 'src/prometheus/prometheus-client.service';
import { SystemInventoryProcessorService } from './system-inventory-processor.service';
import { ZipHandlerService } from 'src/services/zip-handler.service';

@Injectable()
export class SystemInventoryCsvGenerationActivity {
  private readonly logger = new Logger(
    SystemInventoryCsvGenerationActivity.name,
  );

  constructor(
    private readonly prometheusClient: PrometheusClientService,
    private readonly processorService: SystemInventoryProcessorService,
    private readonly zipHandler: ZipHandlerService,
  ) {}

  async generateSystemInventoryCsv({
    traceId,
    payload,
  }: {
    traceId: string;
    payload: any;
  }) {
    this.logger.log(`[${traceId}] Starting System Inventory CSV generation`);

    if (!payload?.otherMetrics?.includes('System Inventory Data')) {
      this.logger.log(
        `[${traceId}] System Inventory Data not requested in otherMetrics, skipping`,
      );
      return 'System Inventory Data CSV generation skipped - not requested';
    }

    const queries = Object.entries(SYS_INV_SPECS_QUERIES);

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
      `[${traceId}] System Inventory CSV generation completed successfully`,
    );

    return 'System Inventory CSV generation completed successfully';
  }

  private extractSuccessfulResults(results: any[]): any[] {
    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      const queryName = Object.keys(SYS_INV_SPECS_QUERIES)[index];
      this.logger.warn(
        `Failed to fetch ${queryName}: ${result.reason.message}`,
      );
      return null;
    });
  }

  private async generateCsvFiles(
    traceId: string,
    data: any,
    zipLocation: string,
  ) {
    const timestamp = Date.now();

    if (data['NETWORK_CONFIG'] && data['NETWORK_CONFIG']?.data?.length > 0) {
      const fileName = `system-inventory-network-config-${timestamp}.csv`;
      await this.zipHandler.addCsvToZip(
        data['NETWORK_CONFIG'].csvContent,
        fileName,
        zipLocation,
        'System Inventory',
      );
      this.logger.log(`[${traceId}] Network Config CSV created: ${fileName}`);
    }

    if (data['DISK_USAGE'] && data['DISK_USAGE']?.data?.length > 0) {
      const fileName = `system-inventory-disk-usage-${timestamp}.csv`;
      await this.zipHandler.addCsvToZip(
        data['DISK_USAGE'].csvContent,
        fileName,
        zipLocation,
        'System Inventory',
      );
      this.logger.log(`[${traceId}] Disk Usage CSV created: ${fileName}`);
    }

    if (
      data['RUNNING_PROCESSES'] &&
      data['RUNNING_PROCESSES']?.data?.length > 0
    ) {
      const fileName = `system-inventory-running-processes-${timestamp}.csv`;
      await this.zipHandler.addCsvToZip(
        data['RUNNING_PROCESSES'].csvContent,
        fileName,
        zipLocation,
        'System Inventory',
      );
      this.logger.log(
        `[${traceId}] Running Processes CSV created: ${fileName}`,
      );
    }

    if (data['SYSTEM_SPECS'] && data['SYSTEM_SPECS']?.data?.length > 0) {
      const fileName = `system-inventory-system-metrics-${timestamp}.csv`;
      await this.zipHandler.addCsvToZip(
        data['SYSTEM_SPECS'].csvContent,
        fileName,
        zipLocation,
        'System Inventory',
      );
      this.logger.log(`[${traceId}] System Metrics CSV created: ${fileName}`);
    }
  }
}
