import {
  Injectable
} from "@nestjs/common";
import {
  RedisUtils
} from "@netapp-cloud-datamigrate/jobs-lib";
import { exec } from "child_process";
import { InventoryService } from "src/inventory/inventory.service";

@Injectable()
export class RedisConsumerService  {
  private redisClient: any;
  private consumers: Map<string, StreamStatus> = new Map();
  constructor(private inventoryService: InventoryService) {}
  async onModuleInit() {
    this.redisClient = await RedisUtils.getClient();
    if (!this.redisClient.isOpen) await this.redisClient.connect();
    this.redisClient.del("consumers");
    this.consumers = await this.redisClient.get("consumers");
  }

  
  async startConsumer(
    jobRunId: string,
    readerName: string,
    consumerType: string
  ) {
    return new Promise((resolve, reject) => {
      exec(
        `pm2 start  dist/redis-consumer/redis-consumer.js --name ${jobRunId}-${consumerType}-consumer -- ${jobRunId} ${readerName} ${consumerType}`,
        (error, stdout, stderr) => {
          if (error) {
            return reject({"message": `Error while starting consumer`});
          }
          resolve({"message": `consumer started:`});
        }
      );
    });
  }

  stopConsumer(jobRunId: string,
    consumerType: string) {
    return new Promise((resolve, reject) => {
      exec(`pm2 stop ${jobRunId}-${consumerType}-consumer`, (error, stdout, stderr) => {
        if (error) {
          return reject({"message": `Error while stopping consumer`});
        }
        resolve({"message": `consumer stopped:`});
      });
    });
  }


  deleteConsumer(jobRunId: string,
    consumerType: string) {
    return new Promise((resolve, reject) => {
      exec(`pm2 delete ${jobRunId}-${consumerType}-consumer`, (error, stdout, stderr) => {
        if (error) {
          return reject({"message": `Error while stopping consumer`});
        }
        resolve({"message": `consumer stopped:`});
      });
    });
  }

  listConsumers() {
    return new Promise((resolve, reject) => {
      exec(`pm2 list`, (error, stdout, stderr) => {
        if (error) {
          return reject(error);
        }
        resolve(stdout);
      });
    });
  }
}

export class StreamStatus {
  isStreamActive: boolean;
  streamKey: string;
  jobRunId: string;
  readerName: string;
  consumerType: string;
}
