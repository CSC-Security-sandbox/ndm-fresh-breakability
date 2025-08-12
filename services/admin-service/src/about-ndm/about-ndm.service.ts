import { Inject, Injectable } from '@nestjs/common';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { PrometheusService } from 'src/utils/prometheus';
import BUILD_VERSION_QUERIES from './about-ndm.constants';
import { AboutNdmResponse } from './about-ndm.interface';

@Injectable()
export class AboutNdmService {
  private readonly logger: LoggerService;

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly prometheusService: PrometheusService,
  ) {
    this.logger = loggerFactory.create(AboutNdmService.name);
  }

  async getAboutNdm(): Promise<AboutNdmResponse> {
    try {
      const results = await Promise.allSettled([
        this.prometheusService.queryPrometheus(
          BUILD_VERSION_QUERIES.CONTROL_PLANE,
        ),
        this.prometheusService.queryPrometheus(BUILD_VERSION_QUERIES.WORKER),
      ]);

      const controlPlaneVersion = this.extractBuildVersion(results[0]);
      const workerVersion = this.extractBuildVersion(results[1]);

      return {
        product: {
          name: 'NDM',
          version: 'Preview',
        },
        build: {
          worker_version: {
            version: workerVersion || 'unknown',
            time: null,
          },
          controlPlane_version: {
            version: controlPlaneVersion || 'unknown',
            time: null,
          },
        },
        contact: {
          email: process.env.NDM_CONTACT_EMAIL || 'niharika@netapp.com',
          phone: process.env.NDM_CONTACT_PHONE || null,
          website: process.env.NDM_CONTACT_WEBSITE || null,
        },
      };
    } catch (error) {
      this.logger.error('Error getting build version', error);
      throw error;
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
