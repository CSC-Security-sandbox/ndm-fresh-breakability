import {
    ChildWorkflowCancellationType,
    ParentClosePolicy,
    proxyActivities,
  } from '@temporalio/workflow';
  import { executeChild } from '@temporalio/workflow';
import { ScanWorkflow } from './scan.workflow';
  
  async function log(traceId: string, message: string) {
    console.log(`[${traceId}] ${message}`);
  }
  
  
  /**
   * This is parent workflow that will call SetupWorkerWorkflow for each workerId
   * @param traceId Unique identifier to trace the request
   * @param payload Payload containing workerIds and fileServer
   * @param options Options to pass to this workflow and all child workflows
   * @returns Returns the result of all child workflows
   */
  export async function MigrationWorkflow({
    traceId,
    payload,
    options,
  }): Promise<any> {
  const result = [];
  const activeWorkerIds = payload.workers;
  
  log(traceId, `Active workers: ${activeWorkerIds}`);
  const discoveryResponse:any = await Promise.all(
      activeWorkerIds.map((workerId) =>
        executeChild(ScanWorkflow,{
          args: [
            {
                jobRunId: traceId
            },
          ],
          workflowId: `MigrationJobWorkflow-${traceId}`,
          taskQueue: `${workerId}-TaskQueue`,
          cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
          parentClosePolicy: ParentClosePolicy.TERMINATE,
        })
      )
    ).then((response) => {  
      log(traceId, `MigrationWorkflow response: ${JSON.stringify(response)}`);
      return {
        traceId: traceId,
        status: 'sucess',
        message: `Migration Successfully  completed for ${traceId}`,
      };
     
    }).catch((error) => { 
      log(traceId, `MigrationWorkflow error: ${error}`);
      return {
        traceId: traceId,
        status: 'error',
        message: `Failed to do migrate for  ${traceId} : ${error}`,
      };
    });
    console.log("MigrationWorkflow res--->" + JSON.stringify(discoveryResponse));
    let discoveryResult = discoveryResponse;
    result.push(discoveryResult);
  
    log(
      traceId,
      `MigrationWorkflow response: ${JSON.stringify(result)}`,
    );
    return result;
      
  }