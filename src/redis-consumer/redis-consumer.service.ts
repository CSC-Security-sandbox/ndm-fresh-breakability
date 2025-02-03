import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { RedisClientType } from "redis";
import {
  JobContextFactory,
  RedisUtils,
  Task,
} from "@netapp-cloud-datamigrate/jobs-lib";
import { InventoryService } from "src/inventory/inventory.service";

@Injectable()
export class RedisConsumerService implements OnModuleDestroy, OnModuleInit {
  private redisClient: any;
  private consumers: Map<string, StreamStatus> = new Map();
  constructor(
    private  inventoryService: InventoryService
  ) { }
  async onModuleInit() {
    console.log("Initializing Redis Consumer Service...");
    this.redisClient = await RedisUtils.getClient();
    if (!this.redisClient.isOpen) await this.redisClient.connect();
    this.consumers = await this.redisClient.get("consumers");
    console.log("Redis Consumer Service Initialized" + this.consumers);
  }

  async listRunningConsumers() {
    return [...this.consumers.keys()];
  }

  async stopConsumer(streamKey: string) {
    this.consumers = JSON.parse(
      (await this.redisClient.get("consumers")) ?? "{}"
    );
    console.log("Consumer Status: inside stop ", this.consumers);
    if (!this.consumers[streamKey]) {
      console.log(`Consumer for ${streamKey} is not running.`);
      return;
    }
    this.consumers = JSON.parse(
      (await this.redisClient.get("consumers")) ?? "{}"
    );
    const status = {
      isStreamActive: false,
      streamKey,
      jobRunId: "",
      readerName: "",
      consumerType: "",
    };
    this.consumers[streamKey]=status;
    console.log("Consumer Status: ", this.consumers);
    await this.redisClient.set("consumers", JSON.stringify(this.consumers));
  }
  async startConsumer(
    streamKey: string,
    jobRunId: string,
    readerName: string,
    consumerType: string
  ) {
    if (this.consumers && this.consumers[streamKey]) {
      console.log(`Consumer for ${streamKey} is already running.`);
      return;
    }

    await this.updateStreamConsumer(streamKey, {
      isStreamActive: true,
      streamKey,
      jobRunId,
      readerName,
      consumerType,
    });

    console.log(`Starting consumer for ${streamKey}...`);
    return { message: `Consumer started for ${streamKey}` };
  }

  async updateStreamConsumer(streamKey: string, status: StreamStatus) {
    this.consumers = JSON.parse(
      (await this.redisClient.get("consumers")) ?? "{}"
    );
    console.log("Consumer Status: ", this.consumers);
    console.log("Prev Consumer Status: ", this.consumers);
    this.consumers[streamKey] = status;
    console.log("Consumer Status: ", this.consumers);
    await this.redisClient.set("consumers", JSON.stringify(this.consumers));
  }
  async stopAllConsumers() {
    for (const key of this.consumers?.keys()) {
      await this.stopConsumer(key);
    }
  }

  getConsumerStatus(streamKey: string) {
    return this.consumers.get(streamKey);
  }

  onModuleDestroy() {
    console.log("Destroying Redis Consumer Service...");
    this.stopAllConsumers();
    if (this.redisClient.isOpen) {
      this.redisClient.del('consumers');
      this.redisClient.quit();}
  }

  async startConsumers() {
    const consumersList = JSON.parse(
      (await this.redisClient.get("consumers")) ?? "{}"
    );
    const contextProvider = JobContextFactory.getProvider(
      "redis",
      this.redisClient
    );
    for (const [streamKey, details] of Object.entries(consumersList)) {
      const streamDetails = JSON.parse(JSON.stringify(details));
      const { jobRunId, readerName, consumerType,isStreamActive } = streamDetails;
      console.log(
        `Scheduling a job for ${streamKey} with jobRunId: ${jobRunId} and isStreamActive: ${isStreamActive} ${consumersList[streamKey].isStreamActive}`
      );
      (async () => {
        while  (true) {
          console.log(`Starting consumer for ${streamKey}`);
          try {
            if (!isStreamActive) {
              console.log(`Stopping consumer for ${streamKey}`);
              delete consumersList[streamKey];
              await this.redisClient.set("consumers", JSON.stringify(consumersList));
              break;
            }
            const jobContext = await contextProvider.getJobContext(jobRunId);
            console.log(`Job Context: ${jobContext}`);
            if (!jobContext) {
              console.log(`Job context not found for ${jobRunId}`);
              break;
            }

            const readerMap = {
              files: jobContext.groupReadFiles(readerName),
              directories: jobContext.groupReadDirs(readerName),
              errors: jobContext.groupReadErrors(readerName),
              tasks: jobContext.readTasks(readerName),
              taskstats: jobContext.groupReadTaskStats(readerName),
            };
            const reader = readerMap[consumerType];
            if (!reader) {
              console.log(`Reader not found for ${consumerType}`);
              break;
            }
            const consumerActions = {
              files: async (file) => {
                console.log(`Processing File: ${file.fileName}`);
                await this.inventoryService.createInventory([file],jobRunId);
              },
              directories: async (directory) => {
                await this.inventoryService.createInventory([directory],jobRunId);
              },
              errors: async (error) => {
                console.error(`Error Log: ${JSON.stringify(error)}`);
              },
              tasks: async (task:Task) => {
                console.log(`Task: ${JSON.stringify(task)}`);
              },
              taskstats: async (taskStat) => {
                console.log(`Task Stats: ${JSON.stringify(taskStat)}`);
              },
            };
            for await (const data of reader) {
              if (consumerActions[consumerType]) {
                await consumerActions[consumerType](data);
              } else {
                console.warn(
                  `No action defined for consumerType: ${consumerType}`
                );
              }
            }
          } catch (err) {
            console.error(
              `Error in consumer 04f52444-4f8b-4b45-a020-f10591be4a84-files:`,
              err
            );
          }
        }
      })();
    }
  }
}

export class StreamStatus {
  isStreamActive: boolean;
  streamKey: string;
  jobRunId: string;
  readerName: string;
  consumerType: string;
}
