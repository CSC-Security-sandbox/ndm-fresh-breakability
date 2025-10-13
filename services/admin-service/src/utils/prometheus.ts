import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { PrometheusConfig } from 'src/config/prometheus.config';

@Injectable()
export class PrometheusService {
  private httpClient: AxiosInstance;
  private prometheusConfig: PrometheusConfig;

  constructor(private readonly configService: ConfigService) {
    this.prometheusConfig =
      this.configService.get<PrometheusConfig>('prometheusConfig');

    this.httpClient = axios.create({
      baseURL: this.prometheusConfig.prometheusBaseIp,
      timeout: this.prometheusConfig.timeout,
    });
  }

  async queryPrometheus(query: string) {
    try {
      const response = await this.httpClient.get('/query', {
        params: {
          query,
        },
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const statusText = error.response?.statusText;
        const data = error.response?.data;
        throw new Error(
          `Prometheus query failed: ${error.message}` +
            (status ? ` | Status: ${status} ${statusText}` : '') +
            (data ? ` | Response: ${JSON.stringify(data)}` : '') +
            ` | Query: ${query}`,
        );
      }

      throw error;
    }
  }
}
