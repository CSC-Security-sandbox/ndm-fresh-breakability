import { proxyActivities } from '@temporalio/workflow';
import { ValidatePathActivity } from 'src/activities/validate-path/validate-path.service';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { validatePath } = proxyActivities<ValidatePathActivity>({ startToCloseTimeout: '300s' });

export async function ValidatePathWorkerWorkflow(
  args: any,
): Promise<any> {
  const paths = args.paths;
  const fileServer = args.fileServer;
  log( args.traceId, `Starting ValidatePathWorkerWorkflow with args: ${JSON.stringify(fileServer)}`);
  let validationResult = [];

  for(const path of paths) {
    const pathId = path.pathId;
    const exportPath = path.path;
    try {
      const result = await validatePath({ 
        path: exportPath,
        host: fileServer.host,
        username: fileServer.username,
        password: fileServer.password,
        protocol: fileServer.type,
        uploadId: args.traceId,
        protocolVersion: fileServer.protocolVersion,
        pathId
      });
      log(args.traceId, `Path validation result for ${pathId}`);
      validationResult.push({ result });
    } catch (error) {
      validationResult.push({
        traceId: args.uploadId,
        status: 'error',
        workerId: this.workerId,
        path: exportPath,
        pathId,
        message: `Error validating path: ${error.message.replace(/,/g, '|').replace(/\n/g, ' ')}`,
      });
    }
  }
  return { validationResult, traceId: args.traceId };
}
