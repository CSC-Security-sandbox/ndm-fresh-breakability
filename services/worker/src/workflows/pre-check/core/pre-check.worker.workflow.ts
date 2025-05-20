import { PrecheckActivity } from "src/activities/precheck/precheck-activity";
import { WorkerTaskPayload } from "../pre-check.types";
import { proxyActivities } from "@temporalio/workflow";
import { PreCheckPathOutput } from "src/activities/precheck/precheck-activity.type";


const {
    preCheckPath: preCheckActivity
} = proxyActivities<PrecheckActivity>({ startToCloseTimeout: '3000s' });

export const  PreCheckWorkerValidationWorkflow = async (workerId:string, workerTaskPayload: WorkerTaskPayload, traceId: string): Promise<{workerId: string, paths:PreCheckPathOutput[]}> => {
    const sourceResponse = await Promise.all(workerTaskPayload.serverPaths.filter(path=>path.isSource).map(async (sourcePath,index) => {
        const sourceTraceId = `${traceId}-${index + 1}`;
        return await preCheckActivity(workerTaskPayload.settings, workerTaskPayload.serverCredentials.find(server=>server.id === sourcePath.serverId), sourcePath, sourceTraceId)
    }))  
    const destinationResponse = await Promise.all(workerTaskPayload.serverPaths.filter(path=>!path.isSource).map(async (destinationPath,index) => {
        const destinationTraceId = `${traceId}-${index + 1}`;
        return await preCheckActivity(workerTaskPayload.settings, workerTaskPayload.serverCredentials.find(server=>server.id === destinationPath.serverId), destinationPath, destinationTraceId)
    })) 
    return {workerId, paths:[...sourceResponse, ...destinationResponse]};
}