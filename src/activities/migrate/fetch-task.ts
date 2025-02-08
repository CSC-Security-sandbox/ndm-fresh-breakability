import { FetchScanTaskInput, FetchScanTaskOutPut } from "./migrate.type";


export const fetchScanTask = async ({jobContext, jobRunId, logger}: FetchScanTaskInput): Promise<FetchScanTaskOutPut> => {
    const batchSize = 500, output:FetchScanTaskOutPut  = {tasks: []};
    try {
        for await (const task of jobContext.groupReadTasks(jobRunId, batchSize)) {
            if(output.tasks.length < batchSize) 
                output.tasks.push(task);
            else break;
        }
        logger.log(`[${jobRunId}] Successfully fetched ${ output.tasks.length} tasks.`);
    }catch(error) {
        logger.error(`[${jobRunId}] Error on fetching tasks.`);
    }
    return output;
}