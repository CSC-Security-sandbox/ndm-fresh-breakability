import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class PrometheusService {
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      baseURL:
        process.env.PROMETHEUS_BASE_URL || 'http://localhost:52061/api/v1',
      timeout: parseInt(process.env.PROMETHEUS_TIMEOUT || '30000', 10),
    });
  }

  async queryPrometheusRange(
    query: string,
    startDate: string,
    endDate: string,
    step: string,
  ) {
    const startParam = `${startDate}T00:00:00.000Z`;
    const endParam = `${endDate}T23:59:59.000Z`;

    const response = await this.httpClient.get('/query_range', {
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
