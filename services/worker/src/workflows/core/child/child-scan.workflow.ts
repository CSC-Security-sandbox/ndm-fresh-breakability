import * as wf from '@temporalio/workflow';
import { CommonActivityService } from "src/activities/common/common.service";
import { CommonTaskService } from 'src/activities/core/common/common-task.service';
import { ScanService } from 'src/activities/core/scan/scan-activity.service';
import { JobRunStatus } from "src/activities/common/enums";
import { updateJobStatusIfNotRunning, validateCommandStreamLength, validateFileStreamLength } from '../common/workflow-utils';
import { ACL_ACTIVITY_TIMEOUT, ITERATIONS_LIMIT } from '../common/workflow-constants';
import { ChildScanWorkflowInput, ChildScanWorkflowOutput } from './chid-scan.workflow.type';
import { MappingResolverService } from 'src/activities/core/initializer/mapping-resolver.service';
import { SetupExportsPathPermissionService } from 'src/activities/core/initializer/setup-exports-path-permission.service';



const {
  updateStatus: updateJobStatusActivity,
} = wf.proxyActivities<CommonActivityService>({
  startToCloseTimeout: '24h',
  heartbeatTimeout: '2m',
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});


const {
  createInitialDirBatch: createInitialDirBatchActivity,
} = wf.proxyActivities<CommonTaskService>({ startToCloseTimeout: '10m' });

const {
    scanDirectories: scanDirectories,
} = wf.proxyActivities<ScanService>({
    retry:{
        maximumAttempts: 3,
        initialInterval: '10s',
        backoffCoefficient: 2.0,
        nonRetryableErrorTypes: ['ActivityFailure','FatalError','CancelledFailure'],
    },
    startToCloseTimeout: '96h',
    heartbeatTimeout: '2m',
});

const {
  resolveUsernamesToSids: resolveUsernamesToSidsActivity,
} = wf.proxyActivities<MappingResolverService>({
  startToCloseTimeout: '10m',
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});


const {
  setupExportPathPermission: setupExportPathPermissionActivity,
  publishAclSetupError: publishAclSetupErrorActivity,
} = wf.proxyActivities<SetupExportsPathPermissionService>({
  startToCloseTimeout: ACL_ACTIVITY_TIMEOUT,
  retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 }
});


const actionSignal = wf.defineSignal<[JobRunStatus]>('scanActionSignal');

export const ChildScanWorkflow = async ({ jobRunId, dirsToScan = ['/'], dirBatchIds = [], batchSize = 100, dirCount = 0, fileCount = 0, isMigration = false, actionState = JobRunStatus.Running, isInitialScan = true, workerConcurrency = 20}: ChildScanWorkflowInput): Promise<ChildScanWorkflowOutput> => {

  await updateJobStatusActivity({jobRunId, status: actionState});
  
  wf.setHandler(actionSignal, async (action:JobRunStatus)=>{    
    actionState = action;
    console.log(jobRunId, `action signal called with value: ${action}`);
  });

  if(isMigration){
    await resolveUsernamesToSidsActivity(jobRunId);
    try {
      await setupExportPathPermissionActivity(jobRunId);
    } catch (error) {
      const message = error?.message ?? String(error);
      console.warn(`[${jobRunId}] setupExportPathPermission failed, continuing with scan/sync: ${message}`);
      await publishAclSetupErrorActivity(jobRunId, `Activity failed : Share root directory ACL stamping.`);
    }
  }

  if(isInitialScan)  {
    const id = await createInitialDirBatchActivity({dirsToScan, jobRunId});
    dirBatchIds.push(id);
  }
  
  const scanWorkflowOutput: ChildScanWorkflowOutput = {
    jobRunId,
    fileCount: fileCount,
    dirCount: dirCount,
    status: JobRunStatus.Running,
    error: undefined,
    excludedPaths: [],
    skippedPaths: [],
  };

  let isStopRequested = false;
  let iterations = 0; 

  while(dirBatchIds.length > 0) {   

    if(actionState === JobRunStatus.Stopped) {
      isStopRequested = true
      console.log(`Stopping ChildScanWorkflow ${jobRunId} as requested. ${actionState}`);
      break;
    }

    const currentBatchIds = dirBatchIds;
    const nextBatchIds: string[] = [];
 
    for (let i = 0; i < currentBatchIds.length; i += workerConcurrency) {
      // wait until the state is paused.
      await updateJobStatusIfNotRunning(actionState, jobRunId);
      await wf.condition(() => actionState !== JobRunStatus.Paused);
      
      try {
        const validationSteps = isMigration
          ? await validateCommandStreamLength(jobRunId, () => actionState)
          : await validateFileStreamLength(jobRunId, () => actionState);
          
        iterations += validationSteps;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`[ERROR] Error validating stream length for jobRunId ${jobRunId}: ${errorMessage}`);
        throw error;
      }

      const batchSlice = currentBatchIds.slice(i, i + workerConcurrency);
      iterations += batchSlice.length;
      
      const batchResults = await Promise.all(
        batchSlice.map(async (batchId) => {
            try {
              return await scanDirectories({batchSize, isMigration, jobRunId, batchId: batchId});
            } catch (error) {
              console.log(`[ERROR] Error scanning directories for batch ${batchId}: ${error.message}`);
              throw error;
            }
          })
        );

      for (const result of batchResults) {
        scanWorkflowOutput.fileCount += result.fileCount;
        scanWorkflowOutput.dirCount += result.dirCount; 
        nextBatchIds.push(...result.batchDirs);
        if (result.excludedPaths?.length) scanWorkflowOutput.excludedPaths!.push(...result.excludedPaths);
        if (result.skippedPaths?.length) scanWorkflowOutput.skippedPaths!.push(...result.skippedPaths);
      }

      if(iterations > ITERATIONS_LIMIT ){
        const remainingBatchIds = currentBatchIds.slice(i + workerConcurrency);
        const nextDirBatchIds = [...nextBatchIds, ...remainingBatchIds];
        console.warn(`ChildScanWorkflow ${jobRunId} exceeded iteration budget (${iterations} > ${ITERATIONS_LIMIT}); continuing as new.`);                      
        await wf.continueAsNew({ jobRunId, dirsToScan, dirBatchIds: nextDirBatchIds, batchSize, dirCount: scanWorkflowOutput.dirCount, fileCount: scanWorkflowOutput.fileCount, isMigration, actionState, isInitialScan: false, workerConcurrency });      
      }
    }
    dirBatchIds = nextBatchIds;
  }
  scanWorkflowOutput.status = isStopRequested ? JobRunStatus.Stopped : JobRunStatus.Completed;

  return scanWorkflowOutput;
}
