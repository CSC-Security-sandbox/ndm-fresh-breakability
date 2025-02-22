import { ContinueAsNew, continueAsNew, proxyActivities } from "@temporalio/workflow";
import { JobRunStatus } from "src/activities/discovery/enums";
import { MigrationSyncService } from "src/activities/migrate/migrate.sync.service";
import { MigrationTaskService } from "src/activities/migrate/migrate.taskmanager.service";

const {
    updateStatus: updateStatusActivity,
    fetchMigrationTask: fetchMigrationTaskActivity,
    updateLastEntry: updateLastEntryActivity
} = proxyActivities<MigrationTaskService>({ startToCloseTimeout: '5h' });

const {
    syncTask: SyncContentActivity
} = proxyActivities<MigrationSyncService>({ startToCloseTimeout: '5h' });

async function log(traceId: string, message: string) {
    console.log(`[${traceId}] ${message}`);
}

export const SyncWorkflow = async ({jobRunId} : {jobRunId: string}) => {
    console.log('Starting SyncWorkflow ', jobRunId)
    let iteration = 0;
    try {
        while (true) {
            let { tasks } = await fetchMigrationTaskActivity({jobRunId}); 
            if (!tasks || tasks.length === 0)  {
                log(jobRunId, `No tasks found. sending last entry`);
                await updateLastEntryActivity(jobRunId)
                .then(() => log(jobRunId, `status updated to Completed`))
                .catch((err) => log(jobRunId, `Failed to update status: ${err}`));
                return { message: 'Sync Completed' };
            }
    
            log(jobRunId, `task found, total -> ${tasks.length}`);
            for(const task of tasks) {
                log(jobRunId, `Starting SYNC for task -> ${task.id}`);
                await SyncContentActivity({task})
                log(jobRunId, `SYNC completed for task -> ${task.id}`);
            }

            if(iteration >= 80) {
                log(jobRunId, `Iteration limit reached. Continuing as new...`);
                await continueAsNew({ jobRunId });
              }
        }
    } catch (error) {
        if (error instanceof ContinueAsNew) {
            log(jobRunId, `Workflow continued as new: ${error.message}`);
            throw error; 
          } else {
            await updateStatusActivity({jobRunId, status: JobRunStatus.Failed})
              .then(() => log(jobRunId, `status updated to Failed`))
              .catch((err) => log(jobRunId, `Failed to update status: ${err}`));
            return { message: `Sync Errored ${error}` };
        }
    }
}
