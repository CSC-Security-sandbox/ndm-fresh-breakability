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

    workflowRequest.payload.serverCredentials.map((serverCredential) => {
        serverCredentials.set(serverCredential.id, serverCredential);
    });

    workflowRequest.payload.preChecks.map((preCheck) => {
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
            discoveredSize: preCheck.discoveredSize
        }
        const sourceVersion = serverCredentials.get(preCheck.serverId).protocolVersion;
        preCheck.destinations.map((destination) => {
            const preCheckDestinationStatus: PreCheckDestinationStatus = {
                destinationPathId: destination.pathId,
                status: PreCheckStatus.SUCCESS ,
                errors: [],
                commonWorkers: destination.workers,
                warnings: []
            }

            if(destination.workers.length === 0) {
                preCheckDestinationStatus.status = PreCheckStatus.FAILED;
                preCheckDestinationStatus.errors.push(PreCheckErrorCodes.NO_COMMON_WORKERS);
            }

            if (destination?.workers?.length > 0 && destination?.workers?.every(worker => worker.ishealthy === false)) {
                preCheckDestinationStatus.status = PreCheckStatus.FAILED;
                preCheckDestinationStatus.errors.push(PreCheckErrorCodes.ALL_COMMON_WORKERS_UNHEALTHY);
            }
            if(sourceVersion !== serverCredentials.get(destination.serverId).protocolVersion) {
                preCheckDestinationStatus.status = PreCheckStatus.FAILED;
                preCheckDestinationStatus.errors.push(PreCheckErrorCodes.PROTOCOL_VERSION_MISMATCH);
            }
            const workerDestinationTaskPaths: WorkerTaskPaths = {
                pathId: destination.pathId,
                serverId: destination.serverId,
                pathName: destination.pathName,
                isSource: false
            }
            destination.workers.map((worker) => {
                if(!workers.includes(worker.workerId) &&  worker.ishealthy) 
                    workers.push(worker.workerId);
                if (workerTasks.has(worker.workerId)) {
                    workerTasks.get(worker.workerId).push(workerDestinationTaskPaths);
                } else {
                    workerTasks.set(worker.workerId, [workerSourceTaskPaths, workerDestinationTaskPaths]);
                }
            })
            serverResponse.destination.push(preCheckDestinationStatus);
        })
        response.push(serverResponse)
    });



    const workflows = workers.map((workerId) => executeChild(PreCheckWorkerValidationWorkflow, {
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


    const allPaths = responseRes.flatMap(workerResponse => workerResponse.paths);
    

    for(let i = 0; i < response.length; i++) {
        const current = response[i];
        const sourceFailed = allPaths.find(path => path.pathId === current.sourcePathId && path.status === PreCheckStatus.FAILED);
        if (sourceFailed) {
                current.status = PreCheckStatus.FAILED;
                current.errors.push(...sourceFailed.errorCodes);
        }

        const sourceRes = allPaths.find(path => path.pathId === current.sourcePathId);
        for (let j = 0; j < current.destination.length; j++) {
            const destination = current.destination[j];
            const destinationFailed = allPaths.find(path => path.pathId === destination.destinationPathId && path.status === PreCheckStatus.FAILED);
            if (destinationFailed) {
                destination.status = PreCheckStatus.FAILED;
                destination.errors.push(...destinationFailed.errorCodes);
            }
            const destinationRes = allPaths.find(path => path.pathId === destination.destinationPathId);
            if (destinationRes?.warnings?.length > 0) {
                destination.warnings.push(...destinationRes.warnings);
            }
            if (sourceRes?.warnings?.length > 0) {
                destination.warnings.push(...sourceRes.warnings);
            }
            if (destinationRes?.destinationAvailableSpace < sourceRes?.sourceDataSize) {
                destination.status =  destination.status != PreCheckStatus.FAILED ?  PreCheckStatus.SUCCESS : PreCheckStatus.FAILED;
                destination.warnings.push(PreCheckErrorCodes.INSUFFICIENT_DESTINATION_SPACE);
            }
        }
    }

    return response;
}