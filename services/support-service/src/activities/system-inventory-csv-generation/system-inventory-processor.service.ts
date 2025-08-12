import { Injectable } from '@nestjs/common';
import { writeToString } from '@fast-csv/format';

export interface ProcessedNetworkConfig {
  device: string;
  address: string;
  broadcast: string;
  adminstate: string;
  operstate: string;
  instance: string;
  job: string;
  node: string;
  namespace: string;
  service: string;
  helm_sh_chart: string;
  app_kubernetes_io_name: string;
  app_kubernetes_io_instance: string;
  app_kubernetes_io_component: string;
  app_kubernetes_io_version: string;
  app_kubernetes_io_managed_by: string;
  app_kubernetes_io_part_of: string;
}

export interface ProcessedDiskUsage {
  usage: number;
  timestamp: string;
}

export interface ProcessedProcess {
  job: string;
  namespace: string;
  node: string;
  service: string;
  k8s_app: string;
  instance: string;
  start_time_iso: string;
  scrape_timestamp: string;
}

export interface ProcessedSystemMetric {
  spec_type: string;
  value: number;
}

export interface PrometheusResponse {
  data: {
    result: Array<{
      metric?: Record<string, string>;
      values?: Array<[number, string]>;
    }>;
  };
}

@Injectable()
export class SystemInventoryProcessorService {
  private readonly NETWORK_CONFIG_HEADERS = [
    'device',
    'address',
    'broadcast',
    'adminstate',
    'operstate',
    'instance',
    'job',
    'node',
    'namespace',
    'service',
    'helm_sh_chart',
    'app_kubernetes_io_name',
    'app_kubernetes_io_instance',
    'app_kubernetes_io_component',
    'app_kubernetes_io_version',
    'app_kubernetes_io_managed_by',
    'app_kubernetes_io_part_of',
  ];

  private async generateCsvContent(
    headers: string[] | false,
    rows: any[][],
  ): Promise<string> {
    return await writeToString(rows, { headers });
  }

  /**
   * Network Config
   */
  private async processNetworkConfig(response: PrometheusResponse) {
    const results = response.data.result || [];

    const processed: ProcessedNetworkConfig[] = results.map((entry) => {
      const labels = entry.metric || {};
      const obj = {} as ProcessedNetworkConfig;
      this.NETWORK_CONFIG_HEADERS.forEach((header) => {
        obj[header as keyof ProcessedNetworkConfig] = labels[header] || '';
      });
      return obj;
    });

    const rows = processed.map((p) =>
      this.NETWORK_CONFIG_HEADERS.map(
        (h) => p[h as keyof ProcessedNetworkConfig],
      ),
    );
    const csvContent = await this.generateCsvContent(
      this.NETWORK_CONFIG_HEADERS,
      rows,
    );

    return { data: processed, csvContent };
  }

  /**
   * Disk Usage
   */
  private async processDiskUsage(response: PrometheusResponse) {
    const values = response.data.result?.[0]?.values || [];
    const processed: ProcessedDiskUsage[] = [];

    const rows: any[][] = [];

    for (const [timestamp, value] of values) {
      const usage = parseFloat(value);
      if (isNaN(usage)) continue;

      const dateTime = new Date(timestamp * 1000).toISOString();
      processed.push({
        usage: parseFloat(usage.toFixed(2)),
        timestamp: dateTime,
      });
      rows.push([usage.toFixed(2), dateTime]);
    }

    const csvContent = await this.generateCsvContent(
      ['usage', 'timestamp'],
      rows,
    );
    return { data: processed, csvContent };
  }

  /**
   * Running Processes
   */
  private async processRunningProcesses(response: PrometheusResponse) {
    const results = response.data.result || [];
    const processed: ProcessedProcess[] = [];
    const rows: any[][] = [];

    for (const entry of results) {
      const labels = entry.metric || {};
      const values = entry.values || [];

      for (const [scrapeTimeUnix, startTimeStr] of values) {
        const startTimeSec = parseFloat(startTimeStr);
        const startTimeISO = new Date(startTimeSec * 1000).toISOString();
        const scrapeTimeISO = new Date(scrapeTimeUnix * 1000).toISOString();

        processed.push({
          job: labels.job || '',
          namespace: labels.namespace || '',
          node: labels.node || '',
          service: labels.service || '',
          k8s_app: labels.k8s_app || '',
          instance: labels.instance || '',
          start_time_iso: startTimeISO,
          scrape_timestamp: scrapeTimeISO,
        });

        rows.push([
          labels.job || '',
          labels.namespace || '',
          labels.node || '',
          labels.service || '',
          labels.k8s_app || '',
          labels.instance || '',
          startTimeISO,
          scrapeTimeISO,
        ]);
      }
    }

    const csvContent = await this.generateCsvContent(
      [
        'job',
        'namespace',
        'node',
        'service',
        'k8s_app',
        'instance',
        'start_time_iso',
        'scrape_timestamp',
      ],
      rows,
    );
    return { data: processed, csvContent };
  }

  /**
   * Generic System Metric
   */
  private async processSystemMetric(
    metric: string,
    response: PrometheusResponse,
  ) {
    const value = parseFloat(response.data.result?.[0]?.values?.[0]?.[1] ?? '');
    if (isNaN(value)) return { data: null, csvContent: '' };

    const processed: ProcessedSystemMetric = {
      spec_type: metric,
      value: parseFloat(value.toFixed(2)),
    };
    const csvContent = await this.generateCsvContent(
      ['spec_type', 'value'],
      [[metric, value.toFixed(2)]],
    );

    return { data: processed, csvContent };
  }

  /**
   * Single metric
   */
  async processMetricData(metric: string, response: PrometheusResponse) {
    if (!response || !response.data || !response.data.result) {
      return { data: null, csvContent: '' };
    }

    switch (metric) {
      case 'NETWORK_CONFIG':
        return this.processNetworkConfig(response);
      case 'DISK_USAGE':
        return this.processDiskUsage(response);
      case 'RUNNING_PROCESSES':
        return this.processRunningProcesses(response);
      default:
        return this.processSystemMetric(metric, response);
    }
  }

  private async processSystemSpecs(
    metricsData: Array<{ metric: string; response: PrometheusResponse }>,
  ) {
    const rows: any[][] = [];
    const processed: ProcessedSystemMetric[] = [];

    for (const { metric, response } of metricsData) {
      const value = parseFloat(
        response.data.result?.[0]?.values?.[0]?.[1] ?? '',
      );
      if (isNaN(value)) continue;

      const rounded = parseFloat(value.toFixed(2));
      processed.push({ spec_type: metric, value: rounded });
      rows.push([metric, rounded.toFixed(2)]);
    }

    const csvContent = await this.generateCsvContent(
      ['spec_type', 'value'],
      rows,
    );

    return { data: processed, csvContent };
  }

  /**
   * Batch
   */
  async processBatchMetrics(
    metricsData: Array<{ metric: string; response: PrometheusResponse }>,
  ) {
    const processedResults: Record<string, { data: any; csvContent: string }> =
      {};

    // Extract the three spec metrics
    const systemSpecMetrics = metricsData.filter(({ metric }) =>
      ['CPU_CORES', 'MEMORY_GB', 'DISK_GB'].includes(metric),
    );

    // Process them together
    if (systemSpecMetrics.length) {
      processedResults['SYSTEM_SPECS'] =
        await this.processSystemSpecs(systemSpecMetrics);
    }

    // Process the rest individually
    for (const { metric, response } of metricsData) {
      if (['CPU_CORES', 'MEMORY_GB', 'DISK_GB'].includes(metric)) continue;

      const result = await this.processMetricData(metric, response);
      if (result.data !== null) {
        processedResults[metric] = result;
      }
    }

    return processedResults;
  }
}
