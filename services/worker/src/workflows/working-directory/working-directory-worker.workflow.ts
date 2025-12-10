import { proxyActivities } from '@temporalio/workflow';
import { ListPathActivity } from 'src/activities/list-path/list-path.service';
import { ExportPathSource } from 'src/activities/list-path/list-path.type';
import { ValidateWorkingDirectoryActivity } from 'src/activities/working-directory/working-directory.service';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { listPath: listPathActivity } = proxyActivities<ListPathActivity>({
  startToCloseTimeout: '30s',
});

const { validateWorkingDirectory: workingDirectoryActivity } = proxyActivities<ValidateWorkingDirectoryActivity>({
  startToCloseTimeout: '30s',
});

export async function ValidateWorkingDirectoryWorkerWorkflow(
  args: any,
): Promise<any> {
  log(args.traceId, `Starting ListPathWorkerWorkflow in ValidateWorkingDirectoryWorkerWorkflow with args: ${JSON.stringify(args)}`);
  
  const results = await Promise.all(
    args.payload.listPathPayload.map(async (data: any) => {
      // Build base payload
      const activityPayload: any = {
        hostname: data.host,
        username: data.username,
        password: data.password,
        exportPathSource: data.exportPathSource,
      };

      // Add serverType if present
      if (data.serverType) {
        activityPayload.serverType = data.serverType;
      }

      // Auto-inject dummy credentials for Dell Isilon
      if (data.serverType === 'DellIsilon') {
        activityPayload.useStorageAPI = true;
        activityPayload.storageApiCredentials = {
          apiEndpoint: 'https://dummy-isilon:8080',
          username: 'dummy-user',
          password: 'dummy-password',
        };
      }

      return await listPathActivity(args.traceId, data.type, activityPayload);
    }),
  );

  let paths = [];

  for (let data of results) {
    paths = [...data.paths];
  }
  args.payload.paths = paths;
  args.payload['hasManualUpload'] = args.payload.listPathPayload.some((item: any) => item.exportPathSource === ExportPathSource.MANUAL_UPLOAD);
  const exportPathWorkingDirectoryProvided = args?.payload?.exportPath?.length > 0;

  if(exportPathWorkingDirectoryProvided) {
    args.payload['exportPathPresent'] = !!args.payload.exportPath;
  }

  args.payload['exportPathWorkingDirectoryProvided'] = exportPathWorkingDirectoryProvided;

  if(!exportPathWorkingDirectoryProvided) {
    args.payload['fetchedPath'] = paths[0];
  }
  args.payload['exportPathWorkingDirectoryProvided'] = exportPathWorkingDirectoryProvided;

  log(args.traceId, `Starting ValidateWorkingDirectoryWorkerWorkflow with args: ${JSON.stringify(args)}`);
  return await workingDirectoryActivity(args.traceId, args.payload);
}
