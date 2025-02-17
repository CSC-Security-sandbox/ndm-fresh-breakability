import { NestFactory } from "@nestjs/core";
import {
  RedisUtils,
  JobContextFactory,
  Task,
  FileInfo,
  DMError,
} from "@netapp-cloud-datamigrate/jobs-lib";
import { AppModule } from "src/app.module";
import { InventoryService } from "src/inventory/inventory.service";
import axios from "axios";
import { RedisConsumerService } from "./redis-consumer.service";

const args = process.argv.slice(2);
const [jobRunId, readerName, consumerType] = args;

export enum ConsumerType {
  files = "files",
  directories = "directories",
  tasks = "tasks",
  updatedTask = "updatedTask",
}

(async () => {
  const app = await NestFactory.create(AppModule);
  const inventoryService = app.get(InventoryService);
  const redisService = app.get(RedisConsumerService);

  const redisClient = await RedisUtils.getClient();
  if (!redisClient.isOpen) await redisClient.connect();

  const contextProvider = JobContextFactory.getProvider("redis", redisClient);
  const jobContext = await contextProvider.getJobContext(jobRunId);
  const { pathId } = jobContext.jobConfig.sourceFileServer;
  const jobServiceUrl = process.env.JOB_SERVICE_URL;
  const reportServiceUrl = process.env.REPORT_SERVICE_URL;
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
      updatedTask: jobContext.readUpdatedTaskInfo(readerName),
    };

    const reader = readerMap[consumerType];
    if (!reader) {
      process.exit(1);
    }

    const consumerActions = {
      files: async (file) => {
        if (file.fileName === "LAST_FILE") {
          await axios.patch(`${jobServiceUrl}/${jobRunId}/COMPLETED`);
          const payload = {
            jobRunId: jobRunId,
            "report-type": "DISCOVER",
          };
          //TODO: call the report service to generate the report from temporal
          await axios.post(
            `${reportServiceUrl}/inventory/generate-report`,
            payload
          );
          console.log(`[${jobRunId}] Discovery status updated to Completed`);
          Object.keys(ConsumerType).forEach(
            async (consumer) =>
              await redisService.deleteConsumer(jobRunId, consumer)
          );
          console.log(`[${jobRunId}] Consumer stopped`);
        } else await inventoryService.createInventory([file], jobRunId, pathId);
      },
      directories: async (directory) => {},
      errors: async (error: DMError) => {
        if (error.operation) {
          await inventoryService.saveOperationError(error);
        }
        if (error.tasks) {
          await inventoryService.saveTaskError(error);
        }
      },
      tasks: async (task: Task) => {
        await inventoryService.saveTasks(task);
      },
      taskstats: async (taskStat) => {},
      updatedTask: async (task: Task) => {
      await inventoryService.saveTasks(task);
      },
    };
    for await (const data of reader) {
      if (consumerActions[consumerType]) {
        await consumerActions[consumerType](data);
      }
    }
  }
})();
