import { NestFactory } from "@nestjs/core";
import {
  DMError,
  JobContextFactory,
  RedisUtils,
  Task,
} from "@netapp-cloud-datamigrate/jobs-lib";
import { defaultDataConverter } from "@temporalio/common";
import { AppModule } from "src/app.module";
import { InventoryService } from "src/inventory/inventory.service";
import { WorkflowService } from "src/workflow/workflow.service";
import { RedisConsumerService } from "./redis-consumer.service";

const args = process.argv.slice(2);
const [jobRunId, readerName, consumerType] = args;

export enum ConsumerType {
  files = "files",
  directories = "directories",
  tasks = "tasks",
  updatedTask = "updatedTask",
  errors = 'errors',
  migrationTask = 'migrationTask',
}

(async () => {
  const app = await NestFactory.create(AppModule);
  const inventoryService = app.get(InventoryService);
  const redisService = app.get(RedisConsumerService);
  const workflowService = app.get(WorkflowService);

  const redisClient = await RedisUtils.getClient();
  if (!redisClient.isOpen) await redisClient.connect();

  const contextProvider = JobContextFactory.getProvider("redis", redisClient);
  const jobContext = await contextProvider.getJobContext(jobRunId);
  const { pathId } = jobContext.jobConfig.sourceFileServer;
  while (true) {
    if (!jobContext) {
      process.exit(1);
    }

    const readerMap = {
      files: jobContext.groupReadFiles(readerName, 500),
      directories: jobContext.readDirs(readerName),
      errors: jobContext.groupReadErrors(readerName, 500),
      tasks: jobContext.readTasks(readerName),
      taskstats: jobContext.groupReadTaskStats(readerName, 500),
      migrationTask:  jobContext.readMigrationTask(readerName),
      updatedTask: jobContext.readUpdatedTaskInfo(readerName),
    };

    const reader = readerMap[consumerType];
    if (!reader) {
      process.exit(1);
    }

    const consumerActions = {
      files: async (file) => {
        if (file.fileName === "LAST_FILE") {

          const jobType = jobContext.jobConfig.jobType;
          const workflowId = getWorkflowId(jobRunId, jobType);

          await workflowService.signalWorkflow({
            namespace: 'default',
            workflowExecution: { workflowId: workflowId },
            signalName: 'reportingSignal',
            input: { payloads:  [defaultDataConverter.payloadConverter.toPayload(`${jobType}_REPORTED`) ]}
          })

          console.log(`[${jobRunId}] Signalling workflow ${workflowId} with signal ${jobType}_REPORTED`);
          
          Object.keys(ConsumerType).forEach(async (consumer) => await redisService.deleteConsumer(jobRunId, consumer));
          console.log(`[${jobRunId}] Consumer stopped`);

        } else await inventoryService.createInventory([file], jobRunId, pathId);
      },
      directories: async (directory) => {},
      errors: async (error: DMError) => {
        if (error.tasks) await inventoryService.saveTaskError(error.tasks);
        if (error.operation) await inventoryService.saveOperationError(error.operation);
      },
      tasks: async (task: Task) => await inventoryService.saveTasks(task),
      migrationTask: async (task: Task) => await inventoryService.saveTasks(task),
      taskstats: async (taskStat) => {},
      updatedTask: async (task: Task) => {
        await inventoryService.updateTask(task.id, { status: task.status });
        if(task.commands.length) {
          await task.commands.map(async (cmd: any) => {
            await inventoryService.updateOperation(cmd.commandId, { status: cmd.status })
          })
        }
      },
    };
    for await (const data of reader) {
      if (consumerActions[consumerType]) {
        await consumerActions[consumerType](data);
      }
    }
  }
})();

export enum WorkFlows {
  DISCOVERY = 'DiscoveryWorkflow',
  PRECHECK='PreCheckValidationWorkflow',
  MIGRATE = 'MigrationWorkflow',
  CUT_OVER = 'CutOverWorkFlow',
}


const getWorkflowId = (jobRunId: string, jobType: string) => {
  if(jobType === 'CUT_OVER') return `${WorkFlows.CUT_OVER}-${jobRunId}`;
  if(jobType === 'MIGRATE') return `${WorkFlows.MIGRATE}-${jobRunId}`;
  if(jobType === 'PRECHECK') return `${WorkFlows.PRECHECK}-${jobRunId}`;
  return `${WorkFlows.DISCOVERY}-${jobRunId}`;
}