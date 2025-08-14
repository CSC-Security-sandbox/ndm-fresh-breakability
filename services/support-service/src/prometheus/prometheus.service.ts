import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosResponse } from 'axios';

@Injectable()
export class PrometheusService {
  private httpClient: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    this.httpClient = axios.create({
      baseURL: this.configService.get<string>(
        'support-bundle.prometheus.baseUrl',
      ),
      timeout: this.configService.get<number>(
        'support-bundle.prometheus.timeout',
      ),
    });
  }

  async queryPrometheusRange(
    query: string,
    startDate: string,
    endDate: string,
    step: string,
  ): Promise<any> {
    const startParam = `${startDate}T00:00:00.000Z`;
    const endParam = `${endDate}T23:59:59.000Z`;

    const response: AxiosResponse = await this.httpClient.get('/query_range', {
      params: {
        query,
        start: startParam,
        end: endParam,
        step,
      },
    });

    return response.data;
  }
}
