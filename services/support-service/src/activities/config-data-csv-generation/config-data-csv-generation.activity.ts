import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm/dist/common/typeorm.decorators';
import {
  ALLOWED_KEYWORDS,
  CSV_FILE_EXTENSION,
  CSV_FILE_PREFIX,
  MASK_VALUE,
  SENSITIVE_PATTERNS,
} from 'src/constants/constants';
import { SQL_QUERIES } from 'src/constants/sql-queries';
import { createCsvString } from 'src/utils/config-data-csv-generation.utils';
import { WorkerEntity } from 'src/entities/worker.entity';
import { ZipHandlerService } from 'src/services/zip-handler.service';
import { DataSource, In, Repository } from 'typeorm';

@Injectable()
export class ConfigurationDataCsvGenerationActivity {
  private readonly logger = new Logger(
    ConfigurationDataCsvGenerationActivity.name,
  );

  constructor(
    @InjectRepository(WorkerEntity)
    private readonly workerRepo: Repository<WorkerEntity>,
    private readonly dataSource: DataSource,
    private readonly zipHandler: ZipHandlerService,
  ) {}

  async generateConfigurationDataCsv({
    traceId,
    payload,
  }: {
    traceId: string;
    payload: any;
  }) {
    const workerIds: string[] = payload?.projectWorkerMap
      .filter((item: any) => item.workerIds !== undefined)
      .map((item: any) => item.workerIds);

    const workerDetails = await this.dataSource.query(
      SQL_QUERIES.GET_WORKER_IDS,
      [workerIds],
    );
    const validWorkerIds: string[] = workerDetails.map(
      (row: any) => row.worker_id,
    );

    if (
      validWorkerIds?.length > 0 &&
      payload?.otherMetrics?.includes('Configuration Data')
    ) {
      await this.generateWorkerCsv(validWorkerIds, payload);
    }
    return 'Configuration data CSV generation completed successfully';
  }

  async generateConfigurationJobCsv({
    traceId,
    payload,
  }: {
    traceId: string;
    payload: any;
  }) {
    const projectIds: string[] = payload?.projectWorkerMap
      .filter((item: any) => item.projectId !== undefined)
      .map((item: any) => item.projectId);

    if (
      projectIds?.length > 0 &&
      payload?.otherMetrics?.includes('Configuration Data')
    ) {
      await this.generateJobConfigCsv(projectIds, payload);
    }
    return 'Configuration data CSV generation completed successfully';
  }

  private async generateWorkerCsv(
    workerIds: string[],
    payload: any,
  ): Promise<void> {
    this.logger.log(`Generating CSV for ${workerIds.length} workers`);

    try {
      const workers = await this.workerRepo.find({
        where: { workerId: In(workerIds) },
        select: ['workerId', 'projectId', 'envVariables'],
      });

      const csvContent = this.createWorkerCsvContent(workers);
      const fileName = `${CSV_FILE_PREFIX}${Date.now()}${CSV_FILE_EXTENSION}`;

      await this.addCsvToZip(csvContent, fileName, payload.zipLocation);
      this.logger.log(
        `Worker CSV file created successfully with ${workers.length} workers`,
      );
    } catch (error: any) {
      this.logger.error('Error generating worker CSV data:', error);
      throw new Error(`Failed to generate worker CSV data: ${error.message}`);
    }
  }

  private async generateJobConfigCsv(
    projectIds: string[],
    payload: any,
  ): Promise<void> {
    this.logger.log(`Fetching job config details for projects: ${projectIds}`);

    try {
      const jobConfigDetails =
        SQL_QUERIES.GET_JOB_CONFIG_DETAILS_WITH_PROJECT_ID_FILTER;

      const result = await this.dataSource.query(jobConfigDetails, [
        projectIds,
      ]);

      this.logger.log(
        `Found ${result.length} job config records with valid volume paths`,
      );

      if (result.length > 0) {
        const csvContent = this.createJobConfigCsvContent(result);
        const fileName = `job_config_details_${Date.now()}.csv`;
        await this.addCsvToZip(csvContent, fileName, payload.zipLocation);
        this.logger.log(
          `Job Config CSV file successfully added to zip: ${fileName}`,
        );
      }
    } catch (error: any) {
      this.logger.error('Error fetching job config details:', error);
      throw new Error(`Failed to fetch job config details: ${error.message}`);
    }
  }

  private createWorkerCsvContent(workers: WorkerEntity[]): string {
    if (workers.length === 0) return '';

    const csvData = workers.map((worker) => this.formatWorkerForCsv(worker));

    // Collect all unique headers from ALL workers (not just the first one)
    const allHeaders = new Set<string>();
    csvData.forEach((row) => {
      Object.keys(row).forEach((header) => allHeaders.add(header));
    });

    const headers = Array.from(allHeaders);

    return this.createCsvString(headers, csvData);
  }

  private createJobConfigCsvContent(jobConfigs: any[]): string {
    if (jobConfigs.length === 0) return '';

    const headers = Object.keys(jobConfigs[0]);
    return this.createCsvString(headers, jobConfigs);
  }

  private createCsvString(
    headers: string[],
    data: Record<string, any>[],
  ): string {
    return createCsvString(headers, data);
  }

  private async addCsvToZip(
    csvContent: string,
    fileName: string,
    zipLocation: string,
  ): Promise<void> {
    await this.zipHandler.addCsvToZip(
      csvContent,
      fileName,
      zipLocation,
      'configuration data',
    );
  }

  private formatWorkerForCsv(worker: WorkerEntity): Record<string, string> {
    const filteredEnvVariables = this.filterEnvVariables(worker.envVariables);

    return {
      'Project ID': worker.projectId || '',
      ...filteredEnvVariables,
    };
  }

  private filterEnvVariables(
    envVariables: Record<string, any>,
  ): Record<string, string> {
    if (!envVariables || typeof envVariables !== 'object') {
      this.logger.log(
        'envVariables is null/undefined or not an object:',
        envVariables,
      );
      return {};
    }

    return Object.entries(envVariables)
      .filter(([key]) => this.isConfigurationVariable(key))
      .reduce(
        (filtered, [key, value]) => {
          const shouldMask = this.containsSensitiveData(key);
          filtered[key] = shouldMask ? MASK_VALUE : String(value || '');
          return filtered;
        },
        {} as Record<string, string>,
      );
  }

  private isConfigurationVariable(key: string): boolean {
    if (key !== key.toUpperCase()) return false;
    const lowerKey = key.toLowerCase();
    return ALLOWED_KEYWORDS.some((keyword) => lowerKey.includes(keyword));
  }

  private containsSensitiveData(key: string): boolean {
    const upperKey = key.toUpperCase();
    return SENSITIVE_PATTERNS.some((pattern) => upperKey.includes(pattern));
  }

  private async createJobConfigCsvFile(
    jobConfigs: any[],
    payload: any,
  ): Promise<void> {
    const timestamp = Date.now();
    const fileName = `job_config_details_${timestamp}.csv`;

    this.logger.log(`Creating Job Config CSV file: ${fileName}`);

    try {
      const csvContent = this.createJobConfigCsvContent(jobConfigs);

      await this.addCsvToZip(
        csvContent,
        fileName,
        payload.zipLocation as string,
      );

      this.logger.log(
        `Job Config CSV file successfully added to zip: ${fileName}`,
      );
    } catch (error: any) {
      this.logger.error(`Job Config CSV creation failed: ${error.message}`);
      throw error;
    }
  }
}
