import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { RedisClientType } from "redis";
import {
  JobContextFactory,
  RedisUtils,
  Task,
} from "@netapp-cloud-datamigrate/jobs-lib";
import { InventoryService } from "src/inventory/inventory.service";
import { exec } from "child_process";

@Injectable()
export class RedisConsumerService  {
  private redisClient: any;
  private consumers: Map<string, StreamStatus> = new Map();
  constructor(private inventoryService: InventoryService) {}
  async onModuleInit() {
    console.log("Initializing Redis Consumer Service...");
    this.redisClient = await RedisUtils.getClient();
    if (!this.redisClient.isOpen) await this.redisClient.connect();
    this.redisClient.del("consumers");
    this.consumers = await this.redisClient.get("consumers");
    console.log("Redis Consumer Service Initialized" + this.consumers);
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
            console.error(`Error starting worker: ${error}`);
            return reject({"message": `Error while starting consumer`});
          }
          console.log(`Worker started: ${stdout}`);
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
          console.error(`Error stopping worker: ${error}`);
          return reject({"message": `Error while stopping consumer`});
        }
        console.log(`Worker stopped: ${stdout}`);
        resolve({"message": `consumer stopped:`});
      });
    });
  }

  listConsumers() {
    return new Promise((resolve, reject) => {
      exec(`pm2 list`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error listing workers: ${error}`);
          return reject(error);
        }
        console.log(`PM2 Process List: ${stdout}`);
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
