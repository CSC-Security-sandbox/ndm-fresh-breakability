import { proxyActivities } from '@temporalio/workflow';
import { ValidatePathActivity } from 'src/activities/validate-path/validate-path.service';
import { VALIDATE_PATH_CONCURRENCY } from '../core/common/workflow-constants';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

const { validatePath } = proxyActivities<ValidatePathActivity>({ startToCloseTimeout: '300s' });

export async function ValidatePathWorkerWorkflow(
  args: any,
): Promise<any> {
  const paths = args.paths;
  const fileServer = args.fileServer;
  log(args.traceId, `Starting ValidatePathWorkerWorkflow with ${paths.length} paths (concurrency=${VALIDATE_PATH_CONCURRENCY})`);

  const results: any[] = [];

  for (let i = 0; i < paths.length; i += VALIDATE_PATH_CONCURRENCY) {
    const batch = paths.slice(i, i + VALIDATE_PATH_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (path) => {
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
            pathId,
          });
          log(args.traceId, `Path validation result for ${pathId}`);
          return { result };
        } catch (error) {
          return {
            traceId: args.traceId,
            status: 'error',
            path: exportPath,
            pathId,
            message: `Error validating path: ${error.message.replace(/,/g, '|').replace(/\n/g, ' ')}`,
          };
        }
      }),
    );
    results.push(...batchResults);
    log(args.traceId, `Validated batch ${i / VALIDATE_PATH_CONCURRENCY + 1}: ${Math.min(i + VALIDATE_PATH_CONCURRENCY, paths.length)}/${paths.length} paths done`);
  }

  return { validationResult: results, traceId: args.traceId };
}
