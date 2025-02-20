import { proxyActivities } from "@temporalio/workflow";
import { MigrationSyncService } from "src/activities/migrate/migrate.sync.service";
import { MigrationTaskService } from "src/activities/migrate/migrate.taskmanger.service";

const {
    fetchMigrationTask: fetchMigrationTaskActivity
} = proxyActivities<MigrationTaskService>({ startToCloseTimeout: '5h' });

const {
    syncTask: SyncContentActivity
} = proxyActivities<MigrationSyncService>({ startToCloseTimeout: '5h' });



export const SyncWorkflow = async ({jobRunId} : {jobRunId: string}) => {
    console.log('Starting SyncWorkflow ', jobRunId)
    try {
        while (true) {
            let { tasks } = await fetchMigrationTaskActivity({jobRunId}); 
            console.log('tasks', tasks)
            if (!tasks || tasks.length === 0) 
                return { message: 'Scan Completed' };
    
            for(const task of tasks) {
                const status = await SyncContentActivity({task});
            }
        }
    } catch (error) {
        return { message: `Scan Errored ${error}` };
    }
}
