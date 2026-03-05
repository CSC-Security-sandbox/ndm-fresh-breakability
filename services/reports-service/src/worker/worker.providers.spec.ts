import { Test, TestingModule } from '@nestjs/testing';
import { workerProviders } from './worker.providers';
import { ActivitiesService } from 'src/activities/activities.service';
import { ConfigService } from '@nestjs/config';
import { Worker, NativeConnection } from '@temporalio/worker';

jest.mock('@temporalio/worker', () => ({
  Worker: {
    create: jest.fn(),
  },
  NativeConnection: {
    connect: jest.fn(),
  },
}));

describe('workerProviders', () => {
  let activitiesService: jest.Mocked<ActivitiesService>;
  let configService: jest.Mocked<ConfigService>;
  let mockWorker: any;
  let mockConnection: any;

  beforeEach(() => {
    activitiesService = {
      generateDiscoveryJsonReport: jest.fn(),
      generateDiscoveryPdfReport: jest.fn(),
      generateDiscoveryCsvReport: jest.fn(),
      updateDiscoveryReport: jest.fn(),
      // Consolidated report activities
      getDiscoveryJobsForFileServer: jest.fn(),
      generatePdfForJobRun: jest.fn(),
      generateCsvForJobRun: jest.fn(),
      mergePdfFilesActivity: jest.fn(),
      mergeCsvFilesActivity: jest.fn(),
      getConsolidatedReportPathActivity: jest.fn(),
      cleanupTempFilesActivity: jest.fn(),
      updateConsolidatedReportStatus: jest.fn(),
    } as any;

    configService = {
      get: jest.fn().mockReturnValue('localhost:7233'),
    } as any;

    mockConnection = {};
    (NativeConnection.connect as jest.Mock).mockResolvedValue(mockConnection);

    mockWorker = {
      run: jest.fn(),
    };
    (Worker.create as jest.Mock).mockResolvedValue(mockWorker);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should create and run a Temporal worker with correct dependencies', async () => {
    const provider = workerProviders.find(p => p.provide === 'TEMPORAL_WORKER');
    expect(provider).toBeDefined();

    // Mock require.resolve for workflowsPath
    const originalRequireResolve = require.resolve;
    (require as any).resolve = jest.fn().mockReturnValue('/mocked/workflows/path');

    const worker = await provider!.useFactory(activitiesService, configService);

    expect(configService.get).toHaveBeenCalledWith('temporal.address');
    expect(NativeConnection.connect).toHaveBeenCalledWith({ address: 'localhost:7233' });
    expect(mockWorker.run).toHaveBeenCalled();
    expect(worker).toBe(mockWorker);

    // Restore require.resolve
    (require as any).resolve = originalRequireResolve;
  });

  it('should bind activity methods to the ActivitiesService instance', async () => {
    const provider = workerProviders.find(p => p.provide === 'TEMPORAL_WORKER');
    (require as any).resolve = jest.fn().mockReturnValue('/mocked/workflows/path');

    await provider!.useFactory(activitiesService, configService);

    const activities = (Worker.create as jest.Mock).mock.calls[0][0].activities;
    activities.generateDiscoveryJsonReport();
    activities.generateDiscoveryPdfReport();
    activities.generateDiscoveryCsvReport();
    activities.updateDiscoveryReport();

    expect(activitiesService.generateDiscoveryJsonReport).toHaveBeenCalled();
    expect(activitiesService.generateDiscoveryPdfReport).toHaveBeenCalled();
    expect(activitiesService.generateDiscoveryCsvReport).toHaveBeenCalled();
    expect(activitiesService.updateDiscoveryReport).toHaveBeenCalled();

    activities.getDiscoveryJobsForFileServer();
    activities.generatePdfForJobRun();
    activities.mergePdfFilesActivity();
    activities.getConsolidatedReportPathActivity();
    activities.cleanupTempFilesActivity();
    activities.updateConsolidatedReportStatus();

    expect(activitiesService.getDiscoveryJobsForFileServer).toHaveBeenCalled();
    expect(activitiesService.generatePdfForJobRun).toHaveBeenCalled();
    expect(activitiesService.mergePdfFilesActivity).toHaveBeenCalled();
    expect(activitiesService.getConsolidatedReportPathActivity).toHaveBeenCalled();
    expect(activitiesService.cleanupTempFilesActivity).toHaveBeenCalled();
    expect(activitiesService.updateConsolidatedReportStatus).toHaveBeenCalled();

    (require as any).resolve = require.resolve;
  });
});