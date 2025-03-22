import { trace } from "console";
import { PreCheckWorkerValidationWorkflow } from "../core/pre-check.worker.workflow";
import { ServerCredential, PreCheckWorkflowRequest, PreCheckWorkflowResponse, PreCheckStatus, PreCheckErrorCodes, PreCheckDestinationStatus, WorkerTaskPaths, WorkerTaskPayload } from "../pre-check.types";
import {
    ChildWorkflowCancellationType,
    ParentClosePolicy,
    executeChild,
    proxyActivities,
  } from '@temporalio/workflow';
import { WorkFlows } from "src/work-manager/work-manager.types";



export const PreCheckValidationWorkflow = async (workflowRequest: PreCheckWorkflowRequest) => {
    const serverCredentials = new Map<string, ServerCredential>();
    const workerTasks = new Map<string, WorkerTaskPaths[]>();
    const workers: string[] = [];

    const response: PreCheckWorkflowResponse[] = []

    workflowRequest.payload.serverCredentials.forEach((serverCredential) => {
        serverCredentials.set(serverCredential.id, serverCredential);
    });

    workflowRequest.payload.preChecks.forEach((preCheck) => {
        const serverResponse: PreCheckWorkflowResponse = {
            sourcePathId: preCheck.pathId,
            status: PreCheckStatus.SUCCESS,
            destination: [],
            errors: []
        }
        const workerSourceTaskPaths: WorkerTaskPaths = {
            pathId: preCheck.pathId,
            serverId: preCheck.serverId,
            pathName: preCheck.pathName,
            isSource: true,
        }
        const sourceVersion = serverCredentials.get(preCheck.serverId).protocolVersion;
        preCheck.destinations.forEach((destination) => {
            const preCheckDestinationStatus: PreCheckDestinationStatus = {
                destinationPathId: destination.pathId,
                status: PreCheckStatus.SUCCESS ,
                errors: [],
                commonWorkers: destination.workers
            }
            if(destination.workers.length === 0) {
                preCheckDestinationStatus.status = PreCheckStatus.FAILED;
                preCheckDestinationStatus.errors.push(PreCheckErrorCodes.NO_COMMON_WORKERS);
                return;
            }
            if(sourceVersion !== serverCredentials.get(destination.serverId).protocolVersion) {
                preCheckDestinationStatus.status = PreCheckStatus.FAILED;
                preCheckDestinationStatus.errors.push(PreCheckErrorCodes.PROTOCOL_VERSION_MISMATCH);
                return;
            }
            const workerDestinationTaskPaths: WorkerTaskPaths = {
                pathId: destination.pathId,
                serverId: destination.serverId,
                pathName: destination.pathName,
                isSource: false
            }
            destination.workers.forEach((workerId) => {
                if(!workers.includes(workerId))
                    workers.push(workerId);
                if (workerTasks.has(workerId)) {
                    workerTasks.get(workerId).push(workerDestinationTaskPaths);
                } else {
                    workerTasks.set(workerId, [workerSourceTaskPaths, workerDestinationTaskPaths]);
                }
            })
            serverResponse.destination.push(preCheckDestinationStatus);
        })
        response.push(serverResponse)
    });


    const workflows =workers.map((workerId) => executeChild(PreCheckWorkerValidationWorkflow, {
            args: [
                workerId, 
                {
                    serverCredentials: (workerTasks.get(workerId) ?? []).map((workerTask) => serverCredentials.get(workerTask.serverId)),
                    serverPaths: workerTasks.get(workerId) ?? [],
                    settings: workflowRequest.payload.settings
                }, 
                workflowRequest.traceId
            ],
            workflowId: `${WorkFlows.PRECHECK}-${workflowRequest.traceId}-${workerId}`,
            taskQueue: `${workerId}-TaskQueue`,
            cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
            parentClosePolicy: ParentClosePolicy.TERMINATE,
        })
    );
    const responseRes = await Promise.all(workflows);

    for(let i = 0; i < response.length; i++) {
        const sourceFailed = responseRes.flatMap((workerResponse) => workerResponse.paths).find((path) => path.pathId === response[i].sourcePathId && path.status === PreCheckStatus.FAILED);
        if(sourceFailed) {
            response[i].status = PreCheckStatus.FAILED;
            response[i].errors.push(sourceFailed.errorCode);
        }
        for(let j = 0; j < response[i].destination.length; j++) {
            const destinationFailed = responseRes.flatMap((workerResponse) => workerResponse.paths).find((path) => path.pathId === response[i].destination[j].destinationPathId && path.status === PreCheckStatus.FAILED);
            if(destinationFailed) {
                response[i].destination[j].status = PreCheckStatus.FAILED;
                response[i].destination[j].errors.push(destinationFailed.errorCode);
            }
        }
    }

    return response;

}