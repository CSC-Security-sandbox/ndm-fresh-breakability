import { proxyActivities } from "@temporalio/workflow";
import { MigrationScanService } from "src/activities/migrate/migrate.scan.service";
import { MigrationTaskService } from "src/activities/migrate/migrate.taskmanger.service";





const { scanPath: scanActivity } = proxyActivities<MigrationScanService>({ startToCloseTimeout: '5h' });

const {
    publishScanTask: publishTaskActivity,  
    fetchScanTask: fetchTaskActivity
} = proxyActivities<MigrationTaskService>({ startToCloseTimeout: '5h' });

  
interface ScanWorkflowInput {
    jobRunId: string;
}

export const ScanWorkflow = async ({jobRunId} : ScanWorkflowInput) => {

    try {
        while (true) {
            let { tasks } = await fetchTaskActivity({jobRunId});
            if (!tasks || tasks.length === 0) {
                return { message: 'Scan Completed' };
            }
    
            for(const task of tasks) {
                const {isTaskCreated} = await scanActivity({task})
                if(isTaskCreated)
                    await publishTaskActivity({jobRunId})
            }
        }
    } catch (error) {
        return { message: 'Scan Errored' };
    }
    return 'ok'
}
