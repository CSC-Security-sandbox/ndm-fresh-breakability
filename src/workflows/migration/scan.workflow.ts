import { JobContext } from "@netapp-cloud-datamigrate/jobs-lib";
import { fetchScanTask } from "src/activities/migrate/fetch-task";
import { publishSanTask } from "src/activities/migrate/publish-task";

import { scanPath } from "src/activities/migrate/scan";
import { getJobConnection } from "src/activities/utils/utils";
import { Logger } from "src/logger/logger.service";

  
interface ScanWorkflowInput {
    jobRunId: string;
}

export const ScanWorkflow = async ({jobRunId} : ScanWorkflowInput) => {
    const logger = new Logger()
    let jobContext:JobContext | null = null, connection=null
    while(true) {
        if(!jobContext || connection) {
            const connecter = await getJobConnection({jobRunId})
            jobContext = connecter.jobContext, connection = connection
        }else {
            const { tasks } = await fetchScanTask({jobContext, jobRunId, logger})
            for(const task of tasks) {
                const { isTaskCreated } = await scanPath({task, jobContext, logger})
                if(isTaskCreated)
                    await publishSanTask({jobRunId, jobContext, logger})
            }
        }
    }
}
