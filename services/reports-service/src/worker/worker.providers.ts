import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Worker, NativeConnection } from '@temporalio/worker';
import { ActivitiesService } from 'src/activities/activities.service';

const logger = new Logger('TemporalWorker');

export const workerProviders = [
  {
    provide: 'TEMPORAL_WORKER',
    inject: [ActivitiesService, ConfigService],
    useFactory: async (
      activitiesService: ActivitiesService,
      configService: ConfigService,
    ) => {
      const activities = {
        // discovery report activities
        generateDiscoveryJsonReport: activitiesService.generateDiscoveryJsonReport.bind(activitiesService),
        generateDiscoveryPdfReport: activitiesService.generateDiscoveryPdfReport.bind(activitiesService),
        generateDiscoveryCsvReport: activitiesService.generateDiscoveryCsvReport.bind(activitiesService),
        updateDiscoveryReport: activitiesService.updateDiscoveryReport.bind(activitiesService),

      };

      const workflowOption = { workflowsPath: require.resolve('../temporal/workflows') };

      const temporalAddress = configService.get<string>('temporal.address');

      const connection = await NativeConnection.connect({
        address: temporalAddress,
      });

      const worker = await Worker.create({
        taskQueue: 'reports-TaskQueue',
        connection,
        ...workflowOption,
        activities,
      });

      worker.run();
      logger.log(`Started worker using NativeConnection at ${temporalAddress}`);

      return worker;
    },
  },
];
