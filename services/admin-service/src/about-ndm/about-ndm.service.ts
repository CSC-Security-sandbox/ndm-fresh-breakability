import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrometheusService } from 'src/utils/prometheus';
import BUILD_VERSION_QUERIES from './about-ndm.constants';
import { AboutNdmResponse, WorkerVersionInfo } from './about-ndm.interface';
import { ConfigService } from '@nestjs/config';
import { WorkerEntity } from '../entities/worker.entity';

@Injectable()
export class AboutNdmService {
  private readonly logger: LoggerService;

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly prometheusService: PrometheusService,
    private readonly configService: ConfigService,
    @InjectRepository(WorkerEntity)
    private readonly workerRepository: Repository<WorkerEntity>,
  ) {
    this.logger = loggerFactory.create(AboutNdmService.name);
  }

  async getAboutNdm(): Promise<AboutNdmResponse> {
    try {
      // CP version from Prometheus (unchanged)
      const cpResult = await this.prometheusService.queryPrometheus(
        BUILD_VERSION_QUERIES.CONTROL_PLANE,
      ).catch((err) => {
        this.logger.warn(`Prometheus CP query failed: ${err.message}`);
        return null;
      });

      const controlPlaneVersion = cpResult
        ? this.extractBuildVersion({ status: 'fulfilled', value: cpResult } as PromiseSettledResult<any>)
        : null;

      // Worker versions from DB (replaces Prometheus worker_info query)
      const workers = await this.workerRepository.find({
        select: ['workerName', 'ipAddress', 'workerVersion', 'platform'],
      });

      // Group workers by version
      const workersByVersion: Record<string, WorkerVersionInfo[]> = {};
      for (const w of workers) {
        const ver = w.workerVersion || 'unknown';
        if (!workersByVersion[ver]) workersByVersion[ver] = [];
        workersByVersion[ver].push({
          workerName: w.workerName,
          ipAddress: w.ipAddress,
          platform: w.platform,
        });
      }

      // Pick latest worker version for backward compatibility
      const versions = Object.keys(workersByVersion).filter(v => v !== 'unknown');
      const latestWorkerVersion = versions.length > 0 ? versions[0] : 'N/A';

      return {
        product: {
          name: 'NDM',
          version: 'Preview',
        },
        build: {
          worker_version: {
            version: latestWorkerVersion,
            time: null,
          },
          controlPlane_version: {
            version: controlPlaneVersion || 'N/A',
            time: null,
          },
          workersByVersion,
        },
        contact: {
          email: this.configService.get<string>(
            'NDM_CONTACT_EMAIL',
            'niharika@netapp.com',
          ),
          phone: this.configService.get<string>('NDM_CONTACT_PHONE', null),
          website: this.configService.get<string>('NDM_CONTACT_WEBSITE', null),
        },
      };
    } catch (error) {
      this.logger.error('Error getting build version', error);
      throw new InternalServerErrorException(
        `Failed to get build version, error: ${error.message}`,
      );
    }
  }

  private extractBuildVersion(
    result: PromiseSettledResult<any>,
  ): string | null {
    try {
      if (result.status !== 'fulfilled') {
        this.logger.warn('Prometheus query was rejected:', result.reason);
        return null;
      }

      const prometheusResponse = result.value;

      if (!prometheusResponse?.data?.result) {
        this.logger.warn(
          'Invalid Prometheus response structure:',
          prometheusResponse,
        );
        return null;
      }

      const prometheusResult = prometheusResponse.data.result;

      // Look for label_build_version in any of the results
      for (const item of prometheusResult) {
        if (item.metric?.label_build_version) {
          this.logger.debug(
            `Found build version: ${item.metric.label_build_version}`,
          );
          return item.metric.label_build_version;
        }
      }

      this.logger.warn('No label_build_version found in Prometheus results');
      return null;
    } catch (error) {
      this.logger.error(
        'Error extracting build version from Prometheus result',
        error,
      );
      return null;
    }
  }
}
