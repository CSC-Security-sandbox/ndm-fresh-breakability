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
        fetchAndZipLogs:
          activitiesService.fetchAndZipLogs.bind(activitiesService),
        notifyWorkflowCompletion:
          activitiesService.notifyWorkflowCompletion.bind(activitiesService),
        generateErrorCsv:
          activitiesService.generateErrorCsv.bind(activitiesService),
        generateConfigurationDataCsv:
          activitiesService.generateConfigurationDataCsv.bind(
            activitiesService,
          ),
        generatePerformanceMetricsCsv:
          activitiesService.generatePerformanceMetricsCsv.bind(
            activitiesService,
          ),
        generateConfigurationJobCsv:
          activitiesService.generateConfigurationJobCsv.bind(activitiesService),
      };

      const workflowOption =
        configService.get<string>('NODE_ENV') === 'production'
          ? {
              workflowBundle: {
                codePath: `${__dirname}/workflow-bundle.js`,
              },
            }
          : { workflowsPath: require.resolve('../temporal/workflows') };

      const temporalAddress = configService.get<string>('temporal.address');

      const connection = await NativeConnection.connect({
        address: temporalAddress,
      });

      const worker = await Worker.create({
        taskQueue: 'Support-TaskQueue',
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
