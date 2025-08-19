import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class PrometheusService {
  private httpClient: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    this.httpClient = axios.create({
      baseURL: this.configService.get<string>(
        'prometheusBaseIp',
        'http://localhost:52061/api/v1',
      ),
      timeout: this.configService.get<number>('PROMETHEUS_TIMEOUT', 30000),
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
