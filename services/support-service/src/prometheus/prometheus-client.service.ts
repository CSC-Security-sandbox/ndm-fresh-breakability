import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrometheusService } from './prometheus.service';
import { PrometheusResponse } from '../activities/state-data-csv-generation/state-data-csv-generation.interface';
// import { PrometheusResponse } from 'src/activities/system-inventory-csv-generation/system-inventory-csv-generation.interface';

@Injectable()
export class PrometheusClientService {
  private readonly logger = new Logger(PrometheusClientService.name);

  constructor(private readonly prometheusService: PrometheusService) {}

  async callPrometheusApi(
    query: string,
    startDate: string,
    endDate: string,
    step: string = '5m',
  ): Promise<PrometheusResponse> {
    try {
      this.logger.log(`Calling Prometheus API with query: ${query}`);
      this.logger.log(`Date params - start: ${startDate}, end: ${endDate}`);

      const response = await this.prometheusService.queryPrometheusRange(
        query,
        startDate,
        endDate,
        step,
      );

      this.logger.log(`Prometheus API response status: ${response.status}`);

      if (response.status === 'success') {
        return response;
      }

      throw new InternalServerErrorException(
        `Prometheus API returned error: ${response.error || 'Unknown error'}`,
      );
    } catch (error) {
      return this.handlePrometheusError(error);
    }
  }

  private handlePrometheusError(error: any): never {
    this.logger.error(`Error calling Prometheus API: ${error.message}`);

    this.logErrorDetails(error);

    if (error.code === 'ECONNREFUSED') {
      throw new InternalServerErrorException(
        'Cannot connect to Prometheus. Make sure Prometheus is running on localhost:52061',
      );
    }

    if (error.response) {
      throw new InternalServerErrorException(
        `Prometheus API error: ${error.response.status} - ${error.response.statusText}. Data: ${JSON.stringify(error.response.data)}`,
      );
    }

    if (error.code === 'ENOTFOUND') {
      throw new InternalServerErrorException(
        'Prometheus server not found. Check if the URL is correct.',
      );
    }

    throw new InternalServerErrorException(
      `Failed to call Prometheus API: ${error.message}`,
    );
  }

  private logErrorDetails(error: any): void {
    if (error.response?.data) {
      this.logger.error(
        `Prometheus response data: ${JSON.stringify(error.response.data)}`,
      );
    }

    if (error.config?.params) {
      this.logger.error(
        `Request params: ${JSON.stringify(error.config.params)}`,
      );
    }
  }
}
