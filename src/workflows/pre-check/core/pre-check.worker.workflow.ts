import { PrecheckActivity } from "src/activities/precheck/precheck-activity";
import { WorkerTaskPayload } from "../pre-check.types";
import { proxyActivities } from "@temporalio/workflow";
import { PreCheckPathOutput } from "src/activities/precheck/precheck-activity.type";


const {
    preCheckPath: preCheckActivity
} = proxyActivities<PrecheckActivity>({ startToCloseTimeout: '3000s' });

export const  PreCheckWorkerValidationWorkflow = async (workerId:string, workerTaskPayload: WorkerTaskPayload, traceId: string): Promise<{workerId: string, paths:PreCheckPathOutput[]}> => {
    const sourceResponse = await Promise.all(workerTaskPayload.serverPaths.filter(path=>path.isSource).map(async (sourcePath) => {
        return await preCheckActivity(workerTaskPayload.settings, workerTaskPayload.serverCredentials.find(server=>server.id === sourcePath.serverId), sourcePath, traceId)
    })) 
    const destinationResponse = await Promise.all(workerTaskPayload.serverPaths.filter(path=>!path.isSource).map(async (sourcePath) => {
        return await preCheckActivity(workerTaskPayload.settings, workerTaskPayload.serverCredentials.find(server=>server.id === sourcePath.serverId), sourcePath, traceId)
    })) 
    return {workerId, paths:[...sourceResponse, ...destinationResponse]};
}