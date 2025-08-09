import { Test, TestingModule } from '@nestjs/testing';
import {
  SystemInventoryProcessorService,
  PrometheusResponse,
} from './system-inventory-processor.service';

describe('SystemInventoryProcessorService', () => {
  let service: SystemInventoryProcessorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SystemInventoryProcessorService],
    }).compile();

    service = module.get<SystemInventoryProcessorService>(
      SystemInventoryProcessorService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processMetricData', () => {
    it('should process NETWORK_CONFIG metric data', async () => {
      const mockResponse: PrometheusResponse = {
        data: {
          result: [
            {
              metric: {
                device: 'eth0',
                address: '192.168.1.10',
                broadcast: '192.168.1.255',
                adminstate: 'up',
                operstate: 'up',
                instance: 'node1:9100',
                job: 'node-exporter',
                node: 'worker-1',
                namespace: 'monitoring',
                service: 'node-exporter',
                helm_sh_chart: 'prometheus-15.8.5',
                app_kubernetes_io_name: 'prometheus',
                app_kubernetes_io_instance: 'prometheus',
                app_kubernetes_io_component: 'server',
                app_kubernetes_io_version: '2.35.0',
                app_kubernetes_io_managed_by: 'Helm',
                app_kubernetes_io_part_of: 'prometheus',
              },
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'NETWORK_CONFIG',
        mockResponse,
      );

      expect(result.data).toHaveLength(1);
      expect(Array.isArray(result.data) && result.data[0]).toBeTruthy();
      if (Array.isArray(result.data)) {
        expect((result.data[0] as any).device).toBe('eth0');
        expect((result.data[0] as any).address).toBe('192.168.1.10');
      }
      expect(result.csvContent).toContain('eth0,192.168.1.10');
    });

    it('should process DISK_USAGE metric data', async () => {
      const mockResponse: PrometheusResponse = {
        data: {
          result: [
            {
              values: [
                [1691539200, '85.5'],
                [1691539215, '86.2'],
              ],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'DISK_USAGE',
        mockResponse,
      );

      expect(result.data).toHaveLength(2);
      if (Array.isArray(result.data)) {
        expect((result.data[0] as any).usage).toBe(85.5);
        expect((result.data[1] as any).usage).toBe(86.2);
      }
      expect(result.csvContent).toContain('85.50');
      expect(result.csvContent).toContain('86.20');
    });

    it('should process RUNNING_PROCESSES metric data', async () => {
      const mockResponse: PrometheusResponse = {
        data: {
          result: [
            {
              metric: {
                job: 'node-exporter',
                namespace: 'monitoring',
                node: 'worker-1',
                service: 'node-exporter',
                k8s_app: 'node-exporter',
                instance: 'node1:9100',
              },
              values: [[1691539200, '1691539000']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'RUNNING_PROCESSES',
        mockResponse,
      );

      expect(result.data).toHaveLength(1);
      if (Array.isArray(result.data)) {
        expect((result.data[0] as any).job).toBe('node-exporter');
        expect((result.data[0] as any).namespace).toBe('monitoring');
      }
      expect(result.csvContent).toContain('node-exporter,monitoring');
    });

    it('should process generic system metric data', async () => {
      const mockResponse: PrometheusResponse = {
        data: {
          result: [
            {
              values: [[1691539200, '8.0']],
            },
          ],
        },
      };

      const result = await service.processMetricData('CPU_CORES', mockResponse);

      expect(result.data).toBeTruthy();
      if (result.data && !Array.isArray(result.data)) {
        expect((result.data as any).spec_type).toBe('CPU_CORES');
        expect((result.data as any).value).toBe(8.0);
      }
      expect(result.csvContent).toContain('CPU_CORES,8.00');
    });

    it('should handle invalid response data', async () => {
      const invalidResponse: PrometheusResponse = {
        data: {
          result: [],
        },
      };

      const result = await service.processMetricData(
        'CPU_CORES',
        invalidResponse,
      );

      expect(result.data).toBeNull();
      expect(result.csvContent).toBe('');
    });

    it('should handle missing response', async () => {
      const result = await service.processMetricData('CPU_CORES', null as any);

      expect(result.data).toBeNull();
      expect(result.csvContent).toBe('');
    });

    it('should handle NaN values gracefully', async () => {
      const mockResponse: PrometheusResponse = {
        data: {
          result: [
            {
              values: [[1691539200, 'invalid']],
            },
          ],
        },
      };

      const result = await service.processMetricData('CPU_CORES', mockResponse);

      expect(result.data).toBeNull();
      expect(result.csvContent).toBe('');
    });
  });

  describe('processBatchMetrics', () => {
    it('should process multiple system spec metrics together', async () => {
      const metricsData = [
        {
          metric: 'CPU_CORES',
          response: {
            data: {
              result: [{ values: [[1691539200, '8.0']] }],
            },
          } as PrometheusResponse,
        },
        {
          metric: 'MEMORY_GB',
          response: {
            data: {
              result: [{ values: [[1691539200, '16.0']] }],
            },
          } as PrometheusResponse,
        },
        {
          metric: 'DISK_GB',
          response: {
            data: {
              result: [{ values: [[1691539200, '500.0']] }],
            },
          } as PrometheusResponse,
        },
      ];

      const result = await service.processBatchMetrics(metricsData);

      expect(result.SYSTEM_SPECS).toBeDefined();
      expect(result.SYSTEM_SPECS.data).toHaveLength(3);
      expect(result.SYSTEM_SPECS.csvContent).toContain('CPU_CORES,8.00');
      expect(result.SYSTEM_SPECS.csvContent).toContain('MEMORY_GB,16.00');
      expect(result.SYSTEM_SPECS.csvContent).toContain('DISK_GB,500.00');
    });

    it('should process individual metrics separately', async () => {
      const metricsData = [
        {
          metric: 'NETWORK_CONFIG',
          response: {
            data: {
              result: [
                {
                  metric: {
                    device: 'eth0',
                    address: '192.168.1.10',
                    broadcast: '',
                    adminstate: '',
                    operstate: '',
                    instance: '',
                    job: '',
                    node: '',
                    namespace: '',
                    service: '',
                    helm_sh_chart: '',
                    app_kubernetes_io_name: '',
                    app_kubernetes_io_instance: '',
                    app_kubernetes_io_component: '',
                    app_kubernetes_io_version: '',
                    app_kubernetes_io_managed_by: '',
                    app_kubernetes_io_part_of: '',
                  },
                },
              ],
            },
          } as PrometheusResponse,
        },
        {
          metric: 'DISK_USAGE',
          response: {
            data: {
              result: [{ values: [[1691539200, '85.5']] }],
            },
          } as PrometheusResponse,
        },
      ];

      const result = await service.processBatchMetrics(metricsData);

      expect(result.NETWORK_CONFIG).toBeDefined();
      expect(result.DISK_USAGE).toBeDefined();
      if (Array.isArray(result.NETWORK_CONFIG.data)) {
        expect((result.NETWORK_CONFIG.data[0] as any).device).toBe('eth0');
      }
      if (Array.isArray(result.DISK_USAGE.data)) {
        expect((result.DISK_USAGE.data[0] as any).usage).toBe(85.5);
      }
    });

    it('should skip metrics with null data', async () => {
      const metricsData = [
        {
          metric: 'CPU_CORES',
          response: {
            data: {
              result: [{ values: [[1691539200, 'invalid']] }],
            },
          } as PrometheusResponse,
        },
        {
          metric: 'MEMORY_GB',
          response: {
            data: {
              result: [{ values: [[1691539200, '16.0']] }],
            },
          } as PrometheusResponse,
        },
      ];

      const result = await service.processBatchMetrics(metricsData);

      expect(result.SYSTEM_SPECS.data).toHaveLength(1);
      if (Array.isArray(result.SYSTEM_SPECS.data)) {
        expect((result.SYSTEM_SPECS.data[0] as any).spec_type).toBe(
          'MEMORY_GB',
        );
      }
    });

    it('should handle empty metrics data', async () => {
      const result = await service.processBatchMetrics([]);

      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should handle mixed valid and invalid responses', async () => {
      const metricsData = [
        {
          metric: 'CPU_CORES',
          response: {
            data: {
              result: [{ values: [[1691539200, '8.0']] }],
            },
          } as PrometheusResponse,
        },
        {
          metric: 'NETWORK_CONFIG',
          response: null as any,
        },
      ];

      const result = await service.processBatchMetrics(metricsData);

      expect(result.SYSTEM_SPECS).toBeDefined();
      expect(result.NETWORK_CONFIG).toBeUndefined();
    });
  });

  describe('network config processing', () => {
    it('should handle missing metric labels', async () => {
      const mockResponse: PrometheusResponse = {
        data: {
          result: [
            {
              metric: {
                device: 'eth0',
                // Missing other labels
              },
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'NETWORK_CONFIG',
        mockResponse,
      );

      expect(result.data).toHaveLength(1);
      if (Array.isArray(result.data)) {
        expect((result.data[0] as any).device).toBe('eth0');
        expect((result.data[0] as any).address).toBe('');
        expect((result.data[0] as any).broadcast).toBe('');
      }
    });

    it('should handle empty network config result', async () => {
      const mockResponse: PrometheusResponse = {
        data: {
          result: [],
        },
      };

      const result = await service.processMetricData(
        'NETWORK_CONFIG',
        mockResponse,
      );

      expect(result.data).toHaveLength(0);
      expect(result.csvContent).toBeDefined(); // Should be defined even if empty
    });
  });

  describe('disk usage processing', () => {
    it('should filter out NaN values in disk usage', async () => {
      const mockResponse: PrometheusResponse = {
        data: {
          result: [
            {
              values: [
                [1691539200, '85.5'],
                [1691539215, 'invalid'],
                [1691539230, '86.2'],
              ],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'DISK_USAGE',
        mockResponse,
      );

      expect(result.data).toHaveLength(2);
      if (Array.isArray(result.data)) {
        expect((result.data[0] as any).usage).toBe(85.5);
        expect((result.data[1] as any).usage).toBe(86.2);
      }
    });

    it('should handle empty values array', async () => {
      const mockResponse: PrometheusResponse = {
        data: {
          result: [
            {
              values: [],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'DISK_USAGE',
        mockResponse,
      );

      expect(result.data).toHaveLength(0);
      expect(result.csvContent).toBeDefined(); // Should be defined even if empty
    });
  });

  describe('running processes processing', () => {
    it('should handle multiple entries with multiple values', async () => {
      const mockResponse: PrometheusResponse = {
        data: {
          result: [
            {
              metric: {
                job: 'node-exporter',
                namespace: 'monitoring',
              },
              values: [
                [1691539200, '1691539000'],
                [1691539215, '1691539010'],
              ],
            },
            {
              metric: {
                job: 'prometheus',
                namespace: 'monitoring',
              },
              values: [[1691539200, '1691538000']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'RUNNING_PROCESSES',
        mockResponse,
      );

      expect(result.data).toHaveLength(3); // 2 + 1 values across entries
      if (Array.isArray(result.data)) {
        expect((result.data[0] as any).job).toBe('node-exporter');
        expect((result.data[2] as any).job).toBe('prometheus');
      }
    });
  });
});
