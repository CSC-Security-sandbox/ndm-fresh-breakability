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
import { GlobalSettings } from 'src/entities/global-setting.entity';
import BUILD_VERSION_QUERIES, { GLOBAL_SETTING_KEYS } from './about-ndm.constants';
import { AboutNdmResponse } from './about-ndm.interface';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AboutNdmService {
  private readonly logger: LoggerService;

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    @InjectRepository(GlobalSettings)
    private readonly globalSettingsRepo: Repository<GlobalSettings>,
    private readonly prometheusService: PrometheusService,
    private readonly configService: ConfigService,
  ) {
    this.logger = loggerFactory.create(AboutNdmService.name);
  }

  async getAboutNdm(): Promise<AboutNdmResponse> {
    try {
      const results = await Promise.allSettled([
        this.prometheusService.queryPrometheus(BUILD_VERSION_QUERIES.WORKER),
      ]);
      const workerVersion = this.extractBuildVersion(results[0]);
      const controlPlaneVersion = await this.getControlPlaneVersion();

      return {
        product: {
          name: 'NDM',
          version: 'Preview',
        },
        build: {
          worker_version: {
            version: workerVersion || 'N/A',
            time: null,
          },
          controlPlane_version: {
            version: controlPlaneVersion || 'N/A',
            time: null,
          },
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

  private async getControlPlaneVersion(): Promise<string | null> {
    try {
      const setting = await this.globalSettingsRepo.findOne({
        where: { settingKey: GLOBAL_SETTING_KEYS.CP_VERSION },
      });

      if (!setting) {
        this.logger.warn(
          `Global setting '${GLOBAL_SETTING_KEYS.CP_VERSION}' not found in database`,
        );
        return null;
      }

      this.logger.debug(
        `Found control plane version from global_settings: ${setting.settingValue}`,
      );
      return setting.settingValue;
    } catch (error) {
      this.logger.error(
        'Error reading control plane version from global_settings',
        error,
      );
      return null;
    }
  }

  private extractBuildVersion(
    prometheusSettledResult: PromiseSettledResult<any>,
  ): string | null {
    try {
      // Handle rejected promise
      if (prometheusSettledResult.status === 'rejected') {
        this.logger.warn(
          'Prometheus query for worker version failed:',
          prometheusSettledResult.reason,
        );
        return null;
      }

      // Handle fulfilled promise
      const prometheusResponse = prometheusSettledResult.value;

      if (!prometheusResponse?.data?.result) {
        this.logger.warn(
          'Invalid Prometheus response structure:',
          prometheusResponse,
        );
        return null;
      }

      const prometheusResult = prometheusResponse.data.result;

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
