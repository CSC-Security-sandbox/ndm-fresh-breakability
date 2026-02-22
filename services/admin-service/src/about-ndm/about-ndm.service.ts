import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { PrometheusService } from 'src/utils/prometheus';
import BUILD_VERSION_QUERIES, { VERSIONS_CONF_PATH } from './about-ndm.constants';
import { AboutNdmResponse } from './about-ndm.interface';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';

@Injectable()
export class AboutNdmService {
  private readonly logger: LoggerService;

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly prometheusService: PrometheusService,
    private readonly configService: ConfigService,
  ) {
    this.logger = loggerFactory.create(AboutNdmService.name);
  }

  async getAboutNdm(): Promise<AboutNdmResponse> {
    try {
      const controlPlaneVersion = this.readCpVersionFromFile();

      const workerResult = await Promise.allSettled([
        this.prometheusService.queryPrometheus(BUILD_VERSION_QUERIES.WORKER),
      ]);
      const workerVersion = this.extractBuildVersion(workerResult[0]);

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

  /**
   * Reads the CP version from /etc/ndm/versions.conf (host-mounted file).
   * The file uses KEY=VALUE format; we look for CP_VERSION.
   */
  private readCpVersionFromFile(): string | null {
    try {
      const versionsPath = this.configService.get<string>(
        'VERSIONS_CONF_PATH',
        VERSIONS_CONF_PATH,
      );

      if (!fs.existsSync(versionsPath)) {
        this.logger.warn(`versions.conf not found at ${versionsPath}`);
        return null;
      }

      const content = fs.readFileSync(versionsPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;

        const [key, ...rest] = trimmed.split('=');
        if (key.trim() === 'CP_VERSION') {
          const version = rest.join('=').trim().replace(/^["']|["']$/g, '');
          this.logger.debug(`Read CP version from file: ${version}`);
          return version || null;
        }
      }

      this.logger.warn('CP_VERSION not found in versions.conf');
      return null;
    } catch (error) {
      this.logger.error(`Error reading versions.conf: ${error.message}`);
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
