import {
  ChildWorkflowCancellationType,
  ParentClosePolicy,
  proxyActivities,
} from '@temporalio/workflow';
import { executeChild } from '@temporalio/workflow';
import { SetupWorkerWorkflow } from '../setup/setup-worker-workflow';
import { CleanupWorkerWorkflow } from '../setup/cleanup-worker-workflow';
import { SpeedTestJobWorkflow } from './speed-test-job-workflow';
import * as wf from '@temporalio/workflow';
import { CommonActivityService } from '../../activities/common/common.service';
import { TaskStatus } from '../../activities/common/enums';
import { JobServiceJobType } from '../../activities/common/enums';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

export const reportingSignal =  wf.defineSignal<[string]>('reportingSignal');

// const { 
//   getJobState: getJobStateActivity,
//   setJobState: setJobStateActivity,
// } = proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h' });
/**
 * This is parent workflow that will call SetupWorkerWorkflow for each workerId
 * @param traceId Unique identifier to trace the request
 * @param payload Payload containing workerIds and fileServer
 * @param options Options to pass to this workflow and all child workflows
 * @returns Returns the result of all child workflows
 */
export async function SpeedTestWorkflow({
  traceId,
  payload,
  options,
}): Promise<any> {
  const activeWorkerIds = [];
  const responseArray = await Promise.all(
    payload.map(async (fileServer) => {
      try {

        const workerResponses = await Promise.all(
          fileServer.workerEntities.map(async (workers) => {
            const workerId = workers.workersId;
            const hostname = fileServer.fileServerDetails.host
            const protocols = []
            const pathId = fileServer.fileServerDetails.volumes.id
            const path = fileServer.fileServerDetails.volumes.volumePath
            const volumeId = fileServer.fileServerDetails.volumes.id
            const username = fileServer.fileServerDetails.userName
            const password = fileServer.fileServerDetails.password
            const protocolType = fileServer.protocol
            const tests = {readTest:fileServer.readTest, writeTest:fileServer.writeTest, networkPerformance:fileServer.packetLossTest}
            return await executeChild(SetupWorkerWorkflow, {
              args: [{ jobRunId: traceId, fileServer, hostname, protocols, pathId, path, username, password, protocolType, volumeId, tests }],
              workflowId: `SetupWorkerWorkflows-${traceId}-${fileServer.fileServer}-${workerId}`,
              taskQueue: `${workerId}-TaskQueue`,
              ...options,
              cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
              parentClosePolicy: ParentClosePolicy.TERMINATE,
            });
          })
        );
        return workerResponses;
      } catch (error) {
        log(traceId, `Error in SetupWorkerWorkflow: ${error}`);
        throw error;
      }
    })
  );
  log(traceId, `SpeedTestWorkflow responseArray: ${JSON.stringify(responseArray)}`);

  let result = responseArray.flat();
  result.map((r) => {
    log(traceId, `SpeedTestWorkflow response in setup workflow: ${JSON.stringify(r)}`);
    if (r.status === 'success') {
      activeWorkerIds.push({workerId:r.workerId, fsDetails: r.fsDetails, fileServerId: r.fileServerId, volumeId: r.volumeId, protocolType: r.protocolType, tests: r.tests});
    }
  });  
  if(!activeWorkerIds.length) {
    log(traceId, `No active workers found`);
    return {
      traceId: traceId,
      status: 'error',
      message: `No active workers found for ${traceId}`,
    }
  }
  log(traceId, `SpeedTestWorkflow activeWorkerIds: ${JSON.stringify(activeWorkerIds)}`);
  
  const speedTestResponse: any = await Promise.all(activeWorkerIds.map(async (workerActivities) => {
    const workerId = workerActivities.workerId;
    const fsDetails = workerActivities.fsDetails;
    const volumeId = workerActivities.volumeId;
    const fileServerId = workerActivities.fileServerId;
    const tests = workerActivities.tests;

    // const jobState = await getJobStateActivity(traceId);
    // const uniqueWorkers = jobState.workers.includes(workerId) ? jobState.workers : [...jobState.workers, workerId];
    // const newJobState = { ...jobState, workers: uniqueWorkers, status: TaskStatus.Running} as any;
    // await setJobStateActivity(traceId, newJobState);
    log(traceId, `Starting SpeedTestJobWorkflow for workerId: ${workerId} and fsDetails: ${fsDetails}`);
    while (true) {
      try {
        return await executeChild(SpeedTestJobWorkflow, {
          args: [{ traceId, workerId , fsDetails, fileServerId, volumeId, tests}],
          workflowId: `SpeedTestJobWorkflow-${traceId}`,
          taskQueue: `${workerId}-TaskQueue`,
          cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
          parentClosePolicy: ParentClosePolicy.TERMINATE,
        });
      } catch (err) {
        if (err.name === 'ContinueAsNew') {
          this.logger.log(`Child workflow continued as new: ${err.workflowId}`);
          continue; // Loop again to wait for the continued execution
        }
        throw err;
      }
    }
  })).then((response) => {
    log(traceId, `SpeedTestWorkflow response: ${JSON.stringify(response)}`);
    return {
      traceId: traceId,
      status: 'sucess',
      message: `SpeedTest Successfully  completed for ${traceId}`,
    };

  }).catch((error) => {
    log(traceId, `SpeedTestWorkflow error: ${error}`);
    return {
      traceId: traceId,
      status: 'error',
      message: `Failed to do Speed Test for  ${traceId} : ${error}`,
    };
  });;

  log(traceId, "SpeedTest response" + JSON.stringify(speedTestResponse));
  result.push(speedTestResponse);

  const cleanupResponse = await Promise.all(
    activeWorkerIds.map(async (workerActivities) => {
      const workerId = workerActivities.workerId;
      const fsDetails = workerActivities.fsDetails;
      const protocolType = workerActivities.protocolType;
      log(traceId, `Starting CleanupWorkerWorkflow for workerId: ${workerId}`);
      try {
        return await executeChild(CleanupWorkerWorkflow, {
          args: [{ jobRunId: traceId, jobType: JobServiceJobType.SPEED_TEST, fsDetails, protocolType}],
          workflowId: `CleanupWorkerWorkflow-${traceId}`,
          taskQueue: `${workerId}-TaskQueue`,
          ...options,
          cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
          parentClosePolicy: ParentClosePolicy.TERMINATE,
        });
      } catch (error) {
        log(traceId, `Error in CleanupWorkerWorkflow: ${error}`);
        throw error;
      }
    }),
  );

    cleanupResponse.flat().map((r) =>
      result.push(r),
    );


  log(traceId, `SpeedTestWorkflow response: ${JSON.stringify(result)}`);
  return speedTestResponse;
}
