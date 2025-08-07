import { Injectable, Logger } from '@nestjs/common';
import { PrometheusClientService } from './prometheus-client.service';
import { PrometheusMetrics } from '../activities/state-data-csv-generation/state-data-csv-generation.interface';
import { PROMETHEUS_QUERIES } from '../activities/state-data-csv-generation/state-data-csv-generation.constants';

@Injectable()
export class PrometheusDataProcessorService {
  private readonly logger = new Logger(PrometheusDataProcessorService.name);

  constructor(private readonly prometheusClient: PrometheusClientService) {}

  async getPrometheusMetrics(
    startDate: string,
    endDate: string,
  ): Promise<PrometheusMetrics> {
    try {
      const queries = Object.values(PROMETHEUS_QUERIES);
      const results = await Promise.allSettled(
        queries.map((queryConfig) =>
          this.prometheusClient.callPrometheusApi(
            queryConfig.query,
            startDate,
            endDate,
            queryConfig.step,
          ),
        ),
      );

      const extractedResults = this.extractSuccessfulResults(results);
      const [
        servicePodStatus,
        cpuUsageCP,
        memoryUsageCP,
        cpuUsageWorker,
        memoryUsageWorker,
        systemUpTime,
      ] = extractedResults;

      return {
        servicePods: this.processServicePods(servicePodStatus),
        allMetrics: this.processAllMetrics({
          cpuUsageCP,
          memoryUsageCP,
          cpuUsageWorker,
          memoryUsageWorker,
          systemUpTime,
        }),
      };
    } catch (error) {
      this.logger.error(`Error fetching Prometheus metrics: ${error.message}`);
      throw error;
    }
  }

  private extractSuccessfulResults(results: any[]): any[] {
    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      const queryName = Object.keys(PROMETHEUS_QUERIES)[index];
      this.logger.warn(
        `Failed to fetch ${queryName}: ${result.reason.message}`,
      );
      return null;
    });
  }

  private processServicePods(servicePodStatus: any): any[] {
    if (!servicePodStatus?.data?.result) {
      return [];
    }

    const uniquePodsMap = new Map<string, any>();

    servicePodStatus.data.result
      .filter(this.isValidPodData)
      .forEach((item: any) => {
        const key = `${item.metric.namespace}-${item.metric.pod}-${item.metric.phase}-${item.values[0][0]}`;
        uniquePodsMap.set(key, {
          Namespace: item.metric.namespace,
          Pod: item.metric.pod,
          Status: item.metric.phase,
          Timestamp: item.values[0][0],
        });
      });

    return Array.from(uniquePodsMap.values());
  }

  private isValidPodData(item: any): boolean {
    return (
      item.metric?.namespace &&
      item.metric?.pod &&
      item.metric?.phase &&
      item.values?.[0]?.[0] !== undefined
    );
  }

  private processAllMetrics(metricsData: {
    cpuUsageCP: any;
    memoryUsageCP: any;
    cpuUsageWorker: any;
    memoryUsageWorker: any;
    systemUpTime: any;
  }): any[] {
    const allMetrics: any[] = [];
    const metricsConfig = [
      { data: metricsData.cpuUsageCP, name: 'CPU Usage of CP' },
      { data: metricsData.memoryUsageCP, name: 'Memory Usage of CP' },
      { data: metricsData.cpuUsageWorker, name: 'CPU Usage of Worker' },
      { data: metricsData.memoryUsageWorker, name: 'Memory Usage of Worker' },
      { data: metricsData.systemUpTime, name: 'System Uptime' },
    ];

    metricsConfig.forEach(({ data, name }) => {
      if (data?.data?.result?.[0]?.values) {
        const processedData = data.data.result[0].values.map((value: any) => ({
          Name: name,
          Timestamp: value[0],
          Usage: value[1],
        }));
        allMetrics.push(...processedData);
      }
    });

    return allMetrics;
  }
}
