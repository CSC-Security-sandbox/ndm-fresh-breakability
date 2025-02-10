import { NestFactory } from "@nestjs/core";
import {
  RedisUtils,
  JobContextFactory,
  Task,
} from "@netapp-cloud-datamigrate/jobs-lib";
import { AppModule } from "src/app.module";
import { InventoryService } from "src/inventory/inventory.service";

const args = process.argv.slice(2);
const [jobRunId, readerName, consumerType] = args;

(async () => {
  const app = await NestFactory.create(AppModule);
  const inventoryService = app.get(InventoryService);

  const redisClient = await RedisUtils.getClient();
  if (!redisClient.isOpen) await redisClient.connect();

  const contextProvider = JobContextFactory.getProvider("redis", redisClient);
  const jobContext = await contextProvider.getJobContext(jobRunId);
  while (true) {

  if (!jobContext) {
    process.exit(1);
  }

  const readerMap = {
    files: jobContext.groupReadFiles(readerName, 500),
    directories: jobContext.readDirs(readerName),
    errors: jobContext.groupReadErrors(readerName, 500),
    tasks: jobContext.readTasks(readerName),
    taskstats: jobContext.groupReadTaskStats(readerName,500),
  };

  const reader = readerMap[consumerType];
  if (!reader) {
    process.exit(1);
  }

  const consumerActions = {
    files: async (file) => {
      await inventoryService.createInventory([file], jobRunId);
    },
    directories: async (directory) => {
      await inventoryService.createInventory([directory], jobRunId);
    },
    errors: async (error) => {
    },
    tasks: async (task: Task) => {
      await inventoryService.saveTasks(task);
    },
    taskstats: async (taskStat) => {
    },
  };
    for await (const data of reader) {
      if (consumerActions[consumerType]) {
        await consumerActions[consumerType](data);
      } 
    }
  }
})();
