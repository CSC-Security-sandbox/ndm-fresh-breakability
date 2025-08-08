import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm/dist/common/typeorm.decorators';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
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
  ) {}

  async generateConfigurationDataCsv({
    traceId,
    payload,
  }: {
    traceId: string;
    payload: any;
  }) {
    const workerDetails = await this.dataSource.query(
      SQL_QUERIES.GET_WORKER_IDS,
    );
    const workerIds = workerDetails.map((row: any) => row.worker_id);

    if (
      workerIds?.length > 0 &&
      payload?.otherMetrics?.includes('Configuration Data')
    ) {
      await this.generateWorkerCsv(workerIds, payload);
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
    const headers = Object.keys(csvData[0]);

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
    const zipPath = zipLocation.endsWith('.zip')
      ? zipLocation
      : path.join(zipLocation, 'support-bundle.zip');

    this.logger.log(`Adding CSV to zip file: ${zipPath}`);

    await fs.promises.mkdir(path.dirname(zipPath), { recursive: true });

    const zipExists = await fs.promises
      .access(zipPath)
      .then(() => true)
      .catch(() => false);

    if (zipExists) {
      await this.addToExistingZip(csvContent, fileName, zipPath);
    } else {
      await this.createNewZipWithCsv(csvContent, fileName, zipPath);
    }
  }

  private async createNewZipWithCsv(
    csvContent: string,
    fileName: string,
    zipPath: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        this.logger.log(
          `New ZIP file created: ${zipPath} (${archive.pointer()} total bytes)`,
        );
        resolve();
      });

      archive.on('error', (err: Error) => {
        this.logger.error(`Archive error: ${err.message}`);
        reject(err);
      });

      archive.pipe(output);
      archive.append(csvContent, { name: `configuration data/${fileName}` });
      void archive.finalize();
    });
  }

  private async addToExistingZip(
    csvContent: string,
    fileName: string,
    zipPath: string,
  ): Promise<void> {
    try {
      const existingZip = new AdmZip(zipPath);
      existingZip.addFile(
        `configuration data/${fileName}`,
        Buffer.from(csvContent, 'utf8'),
      );
      existingZip.writeZip(zipPath);
      this.logger.log(
        `CSV successfully added to existing ZIP file: ${zipPath}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Error adding CSV to existing zip with AdmZip: ${error.message}`,
      );
      this.logger.log('Falling back to archiver-based approach...');
      await this.createNewZipWithCsv(csvContent, fileName, zipPath);
    }
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
    if (!envVariables || typeof envVariables !== 'object') return {};

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
