import { ConfigService } from '@nestjs/config';
import { Worker, NativeConnection } from '@temporalio/worker';
import { ActivitiesService } from 'src/activities/activities.service';

export const workerProviders = [
  {
    provide: 'TEMPORAL_WORKER',
    inject: [ActivitiesService, ConfigService],
    useFactory: async (
      activitiesService: ActivitiesService,
      configService: ConfigService,
    ) => {
      const activities = {
        fetchAndZipLogsUsingFind:
          activitiesService.fetchAndZipLogsUsingFind.bind(activitiesService),
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
      console.log(
        `Started worker using NativeConnection at ${temporalAddress}`,
      );

      return worker;
    },
  },
];
