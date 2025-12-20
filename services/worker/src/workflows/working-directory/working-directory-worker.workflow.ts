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
  
  // Check if this is Dell Isilon - exports already discovered via API
  const isDell = args.payload.serverType === 'Dell';
  let paths = [];
  
  if (isDell) {
    // For Dell Isilon: Skip showmount, exports already discovered via API and stored in DB
    // Use discoveredPaths from payload (populated by config-service from VolumeEntity)
    log(args.traceId, `Dell Isilon: Skipping showmount - exports already discovered via API`);
    paths = args.payload.discoveredPaths || [];
    log(args.traceId, `Dell Isilon: Using ${paths.length} discovered paths from DB`);
  } else {
    // For OtherNAS: Run showmount to discover exports
    log(args.traceId, `OtherNAS: Running showmount to discover exports`);
    const results = await Promise.all(
      args.payload.listPathPayload.map(async (data: any) => {
        return await listPathActivity(args.traceId, data.type, {
          hostname: data.host,
          username: data.username,
          password: data.password,
          exportPathSource: data.exportPathSource,
        });
      }),
    );

    for (let data of results) {
      paths = [...data.paths];
    }
  }

  args.payload.paths = paths;
  args.payload['hasManualUpload'] = args.payload.listPathPayload.some((item: any) => item.exportPathSource === ExportPathSource.MANUAL_UPLOAD);
  
  // For Dell, also pass the dellExportsMap so activity can get export path per host
  if (isDell && args.payload.dellExportsMap) {
    args.payload['isDell'] = true;
  }
  
  const exportPathWorkingDirectoryProvided = args?.payload?.exportPath?.length > 0;

  if(exportPathWorkingDirectoryProvided) {
    args.payload['exportPathPresent'] = !!args.payload.exportPath;
  }

  args.payload['exportPathWorkingDirectoryProvided'] = exportPathWorkingDirectoryProvided;

  if(!exportPathWorkingDirectoryProvided) {
    // For Dell, use dellExportsMap to get first path for the first host
    if (isDell && args.payload.dellExportsMap) {
      const firstHost = args.payload.listPathPayload[0]?.host;
      args.payload['fetchedPath'] = args.payload.dellExportsMap[firstHost] || paths[0];
      log(args.traceId, `Dell Isilon: Using fetchedPath=${args.payload['fetchedPath']} for host ${firstHost}`);
    } else {
      args.payload['fetchedPath'] = paths[0];
    }
  }
  args.payload['exportPathWorkingDirectoryProvided'] = exportPathWorkingDirectoryProvided;

  log(args.traceId, `Starting ValidateWorkingDirectoryWorkerWorkflow with args: ${JSON.stringify(args)}`);
  return await workingDirectoryActivity(args.traceId, args.payload);
}
