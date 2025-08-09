import { Test, TestingModule } from '@nestjs/testing';
import { CsvGeneratorService } from './csv-generator.service';
import * as csvUtils from '../utils/config-data-csv-generation.utils';

// Mock the utility functions
jest.mock('../utils/config-data-csv-generation.utils');

describe('CsvGeneratorService', () => {
  let service: CsvGeneratorService;
  let mockCreateCsvString: jest.MockedFunction<typeof csvUtils.createCsvString>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CsvGeneratorService],
    }).compile();

    service = module.get<CsvGeneratorService>(CsvGeneratorService);

    // Get the mocked function
    mockCreateCsvString = csvUtils.createCsvString as jest.MockedFunction<
      typeof csvUtils.createCsvString
    >;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createServicePodsCsvContent', () => {
    const expectedHeaders = ['Namespace', 'Pod', 'Status', 'Timestamp'];

    it('should return empty string when servicePods array is empty', () => {
      const result = service.createServicePodsCsvContent([]);

      expect(result).toBe('');
      expect(mockCreateCsvString).not.toHaveBeenCalled();
    });

    it('should create CSV content with correct headers for service pods', () => {
      const servicePods = [
        {
          Namespace: 'default',
          Pod: 'pod-1',
          Status: 'Running',
          Timestamp: '1641024000',
        },
        {
          Namespace: 'kube-system',
          Pod: 'pod-2',
          Status: 'Pending',
          Timestamp: '1641024001',
        },
      ];

      const expectedCsvContent =
        'Namespace,Pod,Status,Timestamp\ndefault,pod-1,Running,1641024000\nkube-system,pod-2,Pending,1641024001\n';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createServicePodsCsvContent(servicePods);

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        expectedHeaders,
        servicePods,
      );
      expect(result).toBe(expectedCsvContent);
    });

    it('should handle service pods with missing properties', () => {
      const servicePodsWithMissingProps = [
        {
          Namespace: 'default',
          Pod: 'pod-1',
          // Missing Status and Timestamp
        },
        {
          // Missing all properties
        },
      ];

      const expectedCsvContent =
        'Namespace,Pod,Status,Timestamp\ndefault,pod-1,,\n,,,\n';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createServicePodsCsvContent(
        servicePodsWithMissingProps,
      );

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        expectedHeaders,
        servicePodsWithMissingProps,
      );
      expect(result).toBe(expectedCsvContent);
    });

    it('should handle single service pod', () => {
      const singleServicePod = [
        {
          Namespace: 'test-namespace',
          Pod: 'single-pod',
          Status: 'Running',
          Timestamp: '1641024000',
        },
      ];

      const expectedCsvContent =
        'Namespace,Pod,Status,Timestamp\ntest-namespace,single-pod,Running,1641024000\n';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createServicePodsCsvContent(singleServicePod);

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        expectedHeaders,
        singleServicePod,
      );
      expect(result).toBe(expectedCsvContent);
    });

    it('should handle large arrays of service pods', () => {
      const largeServicePodsArray = Array.from(
        { length: 1000 },
        (_, index) => ({
          Namespace: `namespace-${index}`,
          Pod: `pod-${index}`,
          Status: 'Running',
          Timestamp: `164102400${index}`,
        }),
      );

      const expectedCsvContent = 'large-csv-content';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createServicePodsCsvContent(largeServicePodsArray);

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        expectedHeaders,
        largeServicePodsArray,
      );
      expect(result).toBe(expectedCsvContent);
    });

    it('should handle service pods with special characters', () => {
      const servicePodsWithSpecialChars = [
        {
          Namespace: 'test,namespace',
          Pod: 'pod"with"quotes',
          Status: 'Running\nMultiline',
          Timestamp: '1641024000',
        },
      ];

      const expectedCsvContent =
        '"test,namespace","pod""with""quotes","Running\nMultiline",1641024000\n';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createServicePodsCsvContent(
        servicePodsWithSpecialChars,
      );

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        expectedHeaders,
        servicePodsWithSpecialChars,
      );
      expect(result).toBe(expectedCsvContent);
    });
  });

  describe('createMetricsCsvContent', () => {
    const expectedHeaders = ['Name', 'Timestamp', 'Usage'];

    it('should return empty string when metrics array is empty', () => {
      const result = service.createMetricsCsvContent([]);

      expect(result).toBe('');
      expect(mockCreateCsvString).not.toHaveBeenCalled();
    });

    it('should create CSV content with correct headers for metrics', () => {
      const metrics = [
        {
          Name: 'CPU Usage of CP',
          Timestamp: '1641024000',
          Usage: '50.500',
        },
        {
          Name: 'Memory Usage of Worker',
          Timestamp: '1641024001',
          Usage: '75.200',
        },
      ];

      const expectedCsvContent =
        'Name,Timestamp,Usage\nCPU Usage of CP,1641024000,50.500\nMemory Usage of Worker,1641024001,75.200\n';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createMetricsCsvContent(metrics);

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        expectedHeaders,
        metrics,
      );
      expect(result).toBe(expectedCsvContent);
    });

    it('should handle metrics with missing properties', () => {
      const metricsWithMissingProps = [
        {
          Name: 'CPU Usage',
          // Missing Timestamp and Usage
        },
        {
          Timestamp: '1641024001',
          Usage: '50.0',
          // Missing Name
        },
      ];

      const expectedCsvContent =
        'Name,Timestamp,Usage\nCPU Usage,,\n,1641024001,50.0\n';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createMetricsCsvContent(metricsWithMissingProps);

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        expectedHeaders,
        metricsWithMissingProps,
      );
      expect(result).toBe(expectedCsvContent);
    });

    it('should handle numeric usage values', () => {
      const metricsWithNumbers = [
        {
          Name: 'CPU Usage',
          Timestamp: 1641024000,
          Usage: 50.5,
        },
        {
          Name: 'Memory Usage',
          Timestamp: 1641024001,
          Usage: 0,
        },
      ];

      const expectedCsvContent =
        'Name,Timestamp,Usage\nCPU Usage,1641024000,50.5\nMemory Usage,1641024001,0\n';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createMetricsCsvContent(metricsWithNumbers);

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        expectedHeaders,
        metricsWithNumbers,
      );
      expect(result).toBe(expectedCsvContent);
    });

    it('should handle single metric', () => {
      const singleMetric = [
        {
          Name: 'System Uptime',
          Timestamp: '1641024000',
          Usage: '120.000',
        },
      ];

      const expectedCsvContent =
        'Name,Timestamp,Usage\nSystem Uptime,1641024000,120.000\n';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createMetricsCsvContent(singleMetric);

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        expectedHeaders,
        singleMetric,
      );
      expect(result).toBe(expectedCsvContent);
    });

    it('should handle metrics with special characters in names', () => {
      const metricsWithSpecialChars = [
        {
          Name: 'CPU Usage, Worker-1',
          Timestamp: '1641024000',
          Usage: '50.5',
        },
        {
          Name: 'Memory "Available" %',
          Timestamp: '1641024001',
          Usage: '75.2',
        },
      ];

      const expectedCsvContent =
        '"CPU Usage, Worker-1",1641024000,50.5\n"Memory ""Available"" %",1641024001,75.2\n';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createMetricsCsvContent(metricsWithSpecialChars);

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        expectedHeaders,
        metricsWithSpecialChars,
      );
      expect(result).toBe(expectedCsvContent);
    });
  });

  describe('createBuildDetailsCsvContent', () => {
    const expectedHeaders = [
      'Pod',
      'Build Version',
      'Platform',
      'Worker Id',
      'Timestamp',
    ];

    it('should return empty string when buildDetails array is empty', () => {
      const result = service.createBuildDetailsCsvContent([]);

      expect(result).toBe('');
      expect(mockCreateCsvString).not.toHaveBeenCalled();
    });

    it('should create CSV content with correct headers for build details', () => {
      const buildDetails = [
        {
          Pod: 'control-plane-pod',
          'Build Version': 'v1.0.0',
          Platform: 'linux',
          'Worker Id': 'worker-1',
          Timestamp: '1641024000',
        },
        {
          Pod: 'worker-pod',
          'Build Version': 'v1.1.0',
          Platform: 'windows',
          'Worker Id': 'worker-2',
          Timestamp: '1641024001',
        },
      ];

      const expectedCsvContent =
        'Pod,Build Version,Platform,Worker Id,Timestamp\ncontrol-plane-pod,v1.0.0,linux,worker-1,1641024000\nworker-pod,v1.1.0,windows,worker-2,1641024001\n';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createBuildDetailsCsvContent(buildDetails);

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        expectedHeaders,
        buildDetails,
      );
      expect(result).toBe(expectedCsvContent);
    });

    it('should handle build details with missing properties', () => {
      const buildDetailsWithMissingProps = [
        {
          Pod: 'pod-1',
          'Build Version': 'v1.0.0',
          // Missing Platform, Worker Id, Timestamp
        },
        {
          Platform: 'linux',
          Timestamp: '1641024001',
          // Missing Pod, Build Version, Worker Id
        },
      ];

      const expectedCsvContent =
        'Pod,Build Version,Platform,Worker Id,Timestamp\npod-1,v1.0.0,,,\n,,linux,,1641024001\n';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createBuildDetailsCsvContent(
        buildDetailsWithMissingProps,
      );

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        expectedHeaders,
        buildDetailsWithMissingProps,
      );
      expect(result).toBe(expectedCsvContent);
    });

    it('should handle control plane build details (without Worker Id and Platform)', () => {
      const controlPlaneBuildDetails = [
        {
          Pod: 'control-plane-pod-1',
          'Build Version': 'v2.0.0',
          Timestamp: '1641024000',
        },
        {
          Pod: 'control-plane-pod-2',
          'Build Version': 'v2.0.0',
          Timestamp: '1641024001',
        },
      ];

      const expectedCsvContent =
        'Pod,Build Version,Platform,Worker Id,Timestamp\ncontrol-plane-pod-1,v2.0.0,,,1641024000\ncontrol-plane-pod-2,v2.0.0,,,1641024001\n';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createBuildDetailsCsvContent(
        controlPlaneBuildDetails,
      );

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        expectedHeaders,
        controlPlaneBuildDetails,
      );
      expect(result).toBe(expectedCsvContent);
    });

    it('should handle worker build details (with all properties)', () => {
      const workerBuildDetails = [
        {
          Pod: 'worker-job-1',
          'Build Version': 'v1.5.0',
          Platform: 'linux/amd64',
          'Worker Id': 'worker-001',
          Timestamp: '1641024000',
        },
      ];

      const expectedCsvContent =
        'Pod,Build Version,Platform,Worker Id,Timestamp\nworker-job-1,v1.5.0,linux/amd64,worker-001,1641024000\n';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createBuildDetailsCsvContent(workerBuildDetails);

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        expectedHeaders,
        workerBuildDetails,
      );
      expect(result).toBe(expectedCsvContent);
    });

    it('should handle mixed control plane and worker build details', () => {
      const mixedBuildDetails = [
        {
          Pod: 'control-plane-pod',
          'Build Version': 'v2.0.0',
          Timestamp: '1641024000',
        },
        {
          Pod: 'worker-job',
          'Build Version': 'v1.5.0',
          Platform: 'linux',
          'Worker Id': 'worker-1',
          Timestamp: '1641024001',
        },
      ];

      const expectedCsvContent =
        'Pod,Build Version,Platform,Worker Id,Timestamp\ncontrol-plane-pod,v2.0.0,,,1641024000\nworker-job,v1.5.0,linux,worker-1,1641024001\n';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createBuildDetailsCsvContent(mixedBuildDetails);

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        expectedHeaders,
        mixedBuildDetails,
      );
      expect(result).toBe(expectedCsvContent);
    });

    it('should handle build details with special characters', () => {
      const buildDetailsWithSpecialChars = [
        {
          Pod: 'pod,with,commas',
          'Build Version': 'v1.0.0-"beta"',
          Platform: 'linux\namd64',
          'Worker Id': 'worker-"special"',
          Timestamp: '1641024000',
        },
      ];

      const expectedCsvContent =
        '"pod,with,commas","v1.0.0-""beta""","linux\namd64","worker-""special""",1641024000\n';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createBuildDetailsCsvContent(
        buildDetailsWithSpecialChars,
      );

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        expectedHeaders,
        buildDetailsWithSpecialChars,
      );
      expect(result).toBe(expectedCsvContent);
    });
  });

  describe('edge cases and error handling', () => {
    it('should throw error for null input arrays', () => {
      expect(() => service.createServicePodsCsvContent(null as any)).toThrow();
      expect(() => service.createMetricsCsvContent(null as any)).toThrow();
      expect(() => service.createBuildDetailsCsvContent(null as any)).toThrow();
    });

    it('should throw error for undefined input arrays', () => {
      expect(() =>
        service.createServicePodsCsvContent(undefined as any),
      ).toThrow();
      expect(() => service.createMetricsCsvContent(undefined as any)).toThrow();
      expect(() =>
        service.createBuildDetailsCsvContent(undefined as any),
      ).toThrow();
    });

    it('should handle arrays with null objects', () => {
      const arrayWithNulls = [null, undefined, {}];

      const expectedCsvContent = 'headers\n,,\n,,\n,,\n';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result1 = service.createServicePodsCsvContent(arrayWithNulls);
      const result2 = service.createMetricsCsvContent(arrayWithNulls);
      const result3 = service.createBuildDetailsCsvContent(arrayWithNulls);

      expect(result1).toBe(expectedCsvContent);
      expect(result2).toBe(expectedCsvContent);
      expect(result3).toBe(expectedCsvContent);
    });

    it('should handle very large arrays without performance issues', () => {
      const veryLargeArray = Array.from({ length: 10000 }, (_, index) => ({
        property: `value-${index}`,
      }));

      const expectedCsvContent = 'large-csv-content';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      expect(() => {
        service.createServicePodsCsvContent(veryLargeArray);
        service.createMetricsCsvContent(veryLargeArray);
        service.createBuildDetailsCsvContent(veryLargeArray);
      }).not.toThrow();
    });

    it('should handle objects with non-string properties', () => {
      const dataWithMixedTypes = [
        {
          stringProp: 'string value',
          numberProp: 42,
          booleanProp: true,
          nullProp: null,
          undefinedProp: undefined,
          objectProp: { nested: 'object' },
          arrayProp: [1, 2, 3],
        },
      ];

      const expectedCsvContent = 'mixed-types-csv-content';
      mockCreateCsvString.mockReturnValue(expectedCsvContent);

      const result = service.createServicePodsCsvContent(dataWithMixedTypes);

      expect(mockCreateCsvString).toHaveBeenCalledWith(
        ['Namespace', 'Pod', 'Status', 'Timestamp'],
        dataWithMixedTypes,
      );
      expect(result).toBe(expectedCsvContent);
    });
  });

  describe('integration with createCsvString utility', () => {
    it('should pass correct parameters to createCsvString for each method', () => {
      const testData = [{ test: 'data' }];

      service.createServicePodsCsvContent(testData);
      expect(mockCreateCsvString).toHaveBeenLastCalledWith(
        ['Namespace', 'Pod', 'Status', 'Timestamp'],
        testData,
      );

      service.createMetricsCsvContent(testData);
      expect(mockCreateCsvString).toHaveBeenLastCalledWith(
        ['Name', 'Timestamp', 'Usage'],
        testData,
      );

      service.createBuildDetailsCsvContent(testData);
      expect(mockCreateCsvString).toHaveBeenLastCalledWith(
        ['Pod', 'Build Version', 'Platform', 'Worker Id', 'Timestamp'],
        testData,
      );

      expect(mockCreateCsvString).toHaveBeenCalledTimes(3);
    });

    it('should return exactly what createCsvString returns', () => {
      const testData = [{ test: 'data' }];
      const expectedOutput = 'test,csv,output\ndata,row,1\n';

      mockCreateCsvString.mockReturnValue(expectedOutput);

      const result1 = service.createServicePodsCsvContent(testData);
      const result2 = service.createMetricsCsvContent(testData);
      const result3 = service.createBuildDetailsCsvContent(testData);

      expect(result1).toBe(expectedOutput);
      expect(result2).toBe(expectedOutput);
      expect(result3).toBe(expectedOutput);
    });
  });

  describe('method behavior consistency', () => {
    it('should all return empty string for empty arrays', () => {
      const result1 = service.createServicePodsCsvContent([]);
      const result2 = service.createMetricsCsvContent([]);
      const result3 = service.createBuildDetailsCsvContent([]);

      expect(result1).toBe('');
      expect(result2).toBe('');
      expect(result3).toBe('');
    });

    it('should all call createCsvString when arrays have data', () => {
      const testData = [{ test: 'data' }];

      mockCreateCsvString.mockReturnValue('csv-content');

      service.createServicePodsCsvContent(testData);
      service.createMetricsCsvContent(testData);
      service.createBuildDetailsCsvContent(testData);

      expect(mockCreateCsvString).toHaveBeenCalledTimes(3);
    });

    it('should use different headers for each method', () => {
      const testData = [{ test: 'data' }];

      mockCreateCsvString.mockReturnValue('csv-content');

      service.createServicePodsCsvContent(testData);
      service.createMetricsCsvContent(testData);
      service.createBuildDetailsCsvContent(testData);

      expect(mockCreateCsvString).toHaveBeenNthCalledWith(
        1,
        ['Namespace', 'Pod', 'Status', 'Timestamp'],
        testData,
      );
      expect(mockCreateCsvString).toHaveBeenNthCalledWith(
        2,
        ['Name', 'Timestamp', 'Usage'],
        testData,
      );
      expect(mockCreateCsvString).toHaveBeenNthCalledWith(
        3,
        ['Pod', 'Build Version', 'Platform', 'Worker Id', 'Timestamp'],
        testData,
      );
    });
  });
});
