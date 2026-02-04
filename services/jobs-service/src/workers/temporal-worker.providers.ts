import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Worker, NativeConnection } from '@temporalio/worker';
import { ActivitiesService } from 'src/activities/activities.service';

const logger = new Logger('TemporalWorker');

export const temporalWorkerProviders = [
  {
    provide: 'TEMPORAL_WORKER',
    inject: [ActivitiesService, ConfigService],
    useFactory: async (
      activitiesService: ActivitiesService,
      configService: ConfigService,
    ) => {
      const activities = {
        mountExportPath: activitiesService.mountExportPath.bind(activitiesService),
        listDirectories: activitiesService.listDirectories.bind(activitiesService),
        unmountExportPath: activitiesService.unmountExportPath.bind(activitiesService),
        storeResultInRedis: activitiesService.storeResultInRedis.bind(activitiesService),
      };

      const workflowOption = { workflowsPath: require.resolve('../temporal/workflows') };
      const temporalAddress = configService.get<string>('temporal.address');

      const connection = await NativeConnection.connect({
        address: temporalAddress,
      });

      const worker = await Worker.create({
        taskQueue: 'JobsService-ListDirs-TaskQueue',
        connection,
        ...workflowOption,
        activities,
      });

      worker.run();
      logger.log(`Started JobsService embedded worker at ${temporalAddress}`);

      return worker;
    },
  },
];