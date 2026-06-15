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
import { GlobalSettings } from '../entities/global-setting.entity';
import { promises as fs } from 'fs';
import {
  SERIAL_ID_CONF_PATH,
  SERIAL_ID_SETTING_KEY,
} from './about-ndm.constants';

const SERIAL_REGEX = /^975[0-9]{17}$/;

@Injectable()
export class AboutNdmService {
  private readonly logger: LoggerService;

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly prometheusService: PrometheusService,
    private readonly configService: ConfigService,
    @InjectRepository(WorkerEntity)
    private readonly workerRepository: Repository<WorkerEntity>,
    @InjectRepository(GlobalSettings)
    private readonly settingsRepository: Repository<GlobalSettings>,
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
        select: { workerName: true, ipAddress: true, workerVersion: true, platform: true },
        take: 1000,
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
      const serialId = await this.getSerialId();

      return {
        product: {
          name: 'NDM',
          version: 'Preview',
          serialId: serialId || 'N/A',
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

  private async getSerialId(): Promise<string | null> {
    try {
      const setting = await this.settingsRepository.findOne({
        where: { settingKey: SERIAL_ID_SETTING_KEY },
      });
      if (setting?.serialId && SERIAL_REGEX.test(setting.serialId)) {
        return setting.serialId;
      }
      if (setting?.settingValue && SERIAL_REGEX.test(setting.settingValue)) {
        return setting.settingValue;
      }
    } catch (error) {
      this.logger.warn(`Failed to read serial ID from global_settings: ${error.message}`);
    }

    try {
      const content = await fs.readFile(SERIAL_ID_CONF_PATH, 'utf-8');
      const match = content.match(/^\s*serial_id=(975[0-9]{17})\s*$/m);
      return match?.[1] ?? null;
    } catch (error) {
      this.logger.warn(`Failed to read serial ID from serial file: ${error.message}`);
      return null;
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
