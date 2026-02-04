import {
    defineSignal,
    setHandler,
    condition,
    proxyActivities,
    workflowInfo,
    log,
    CancellationScope,
  } from '@temporalio/workflow';
  
  import type { ActivitiesService } from 'src/activities/activities.service';
  
  const { mountExportPath, listDirectories, unmountExportPath, storeResultInRedis } =
    proxyActivities<ActivitiesService>({
      startToCloseTimeout: '30m',
      retry: {
        maximumAttempts: 3,
      },
    });
  
  // Define signals
  export const listDirSignal = defineSignal<[{ requestId: string; path: string }]>('listDir');
  export const terminateSignal = defineSignal('terminate');
  
  export interface ListDirsWorkflowInput {
    fileServerId: string;
    hostname: string;
    exportPath: string;
    protocol: string;
    username?: string;
    password?: string;
    protocolVersion?: string;
  }
  
  export async function ListDirsWorkflow(input: ListDirsWorkflowInput): Promise<void> {
    const wfInfo = workflowInfo();
    const workflowId = wfInfo.workflowId;
  
    log.info(`Starting ListDirsWorkflow: ${workflowId}`);
  
    let isRunning = true;
    let mountPath: string | null = null;
  
    try {
      // Mount the export path once
      mountPath = await mountExportPath(input);
      log.info(`Mounted export path to: ${mountPath}`);
  
      // Handle terminate signal
      setHandler(terminateSignal, () => {
        log.info('Received terminate signal');
        isRunning = false;
      });
  
      // Handle listDir signals
      setHandler(listDirSignal, async ({ requestId, path }) => {
        const redisKey = `${workflowId}-${requestId}`;
        log.info(`Received listDir signal: requestId=${requestId}, path=${path}`);
  
        try {
          const directories = await listDirectories({ mountPath: mountPath!, path });
          console.log(directories);
          await storeResultInRedis({
            key: redisKey,
            result: { status: 'COMPLETED', directories },
          });
          log.info(`Stored result for ${redisKey}: ${directories.length} directories`);
        } catch (error) {
          log.error(`Error listing directories: ${error.message}`);
          await storeResultInRedis({
            key: redisKey,
            result: { status: 'ERROR', errorMessage: error.message },
          });
        }
      });
  
      // Keep workflow alive until terminate signal
      await condition(() => !isRunning);
    } finally {
      // Cleanup: unmount
      if (mountPath) {
        const pathToUnmount = mountPath;
        await CancellationScope.nonCancellable(async () => {
        try {
            await unmountExportPath(pathToUnmount);
            log.info('Unmounted export path');
        } catch (error) {
            log.error(`Error unmounting: ${error.message}`);
        }     
        });
      }
    }
  
    log.info('ListDirsWorkflow completed');
  }