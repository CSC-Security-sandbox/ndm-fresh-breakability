// import { JobContext, JobContextFactory, RedisUtils, Task } from "@netapp-cloud-datamigrate/jobs-lib";
// import { fetchScanTask } from "src/activities/migrate/fetch-task";
// import { getJobConnection } from "src/activities/utils/utils";

// function log(traceId: string, message: string) {
//     console.log(`[${traceId}] ${message}`);
// }

  
// interface ScanWorkflowInput {
//     jobRunId: string;
// }

// export const ScanWorkflow = async ({jobRunId} : ScanWorkflowInput) => {
//     let jobContext:JobContext | null = null, connection=null
//     while(true) {
//         if(!jobContext || connection) {
//             const connecter = await getJobConnection({jobRunId})
//             jobContext = connecter.jobContext, connection = connection
//         }else {
//             const tasks: Task[] = await fetchScanTask(jobContext)
//             for(const task of tasks) {
//                 const isTaskCreated = await scanPath(task, jobContext)
//                 if(isTaskCreated)
//                     await publishSyncTask(jobContext, jobContext)
//             }
//         }
//     }
// }
