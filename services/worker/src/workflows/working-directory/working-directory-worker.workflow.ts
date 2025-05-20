import { proxyActivities } from '@temporalio/workflow';
import { ListPathActivity } from 'src/activities/list-path/list-path.service';
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
      return await listPathActivity(args.traceId, data.type, {
        hostname: data.host,
        username: data.username,
        password: data.password
      });
    }),
  );

  let paths = [];

  for (let data of results) {
    paths = [...data.paths];
  }
  
  const exportPathWorkingDirectoryProvided = args?.payload?.exportPath?.length > 0;

  if(exportPathWorkingDirectoryProvided) {
    const exportPath = paths.includes(args.payload.exportPath);
    args.payload['exportPathPresent'] = exportPath;
  }

  args.payload['exportPathWorkingDirectoryProvided'] = exportPathWorkingDirectoryProvided;

  if(!exportPathWorkingDirectoryProvided) {
    args.payload['fetchedPath'] = paths[0];
  }
  args.payload['exportPathWorkingDirectoryProvided'] = exportPathWorkingDirectoryProvided;

  log(args.traceId, `Starting ValidateWorkingDirectoryWorkerWorkflow with args: ${JSON.stringify(args)}`);
  return await workingDirectoryActivity(args.traceId, args.payload);
}
