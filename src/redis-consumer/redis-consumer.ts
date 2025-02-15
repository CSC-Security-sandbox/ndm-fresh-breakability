import { NestFactory } from "@nestjs/core";
import {
  RedisUtils,
  JobContextFactory,
  Task,
  FileInfo,
} from "@netapp-cloud-datamigrate/jobs-lib";
import { AppModule } from "src/app.module";
import { InventoryService } from "src/inventory/inventory.service";
import axios from "axios";
import { RedisConsumerService } from "./redis-consumer.service";

const args = process.argv.slice(2);
const [jobRunId, readerName, consumerType] = args;

(async () => {
  const app = await NestFactory.create(AppModule);
  const inventoryService = app.get(InventoryService);
  const redisService = app.get(RedisConsumerService);

  const redisClient = await RedisUtils.getClient();
  if (!redisClient.isOpen) await redisClient.connect();

  const contextProvider = JobContextFactory.getProvider("redis", redisClient);
  const jobContext = await contextProvider.getJobContext(jobRunId);
  const {pathId} = jobContext.jobConfig.sourceFileServer;
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
    taskstats: jobContext.groupReadTaskStats(readerName,500),
  };

  const reader = readerMap[consumerType];
  if (!reader) {
    process.exit(1);
  }

  const consumerActions = {
    files: async (file) => {
      if(file.fileName==="LAST_FILE") {
        //update the dob as completed and also stop the consumer.
        await axios.patch(`${jobServiceUrl}/${jobRunId}/COMPLETED`);
        console.log(`[${jobRunId}] Discovery status updated to Completed`);
        await redisService.stopConsumer(jobRunId,consumerType);
        console.log(`[${jobRunId}] Consumer stopped`);
        const payload = {
          jobRunIds : [jobRunId],
          reportType: 'DISCOVER'
        }
        await axios.post(`${reportServiceUrl}/inventory/generate-report`,payload);
      }else
      await inventoryService.createInventory([file], jobRunId,pathId);
    },
    directories: async (directory) => {
   //   await inventoryService.createInventory([directory], jobRunId,pathId);
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
