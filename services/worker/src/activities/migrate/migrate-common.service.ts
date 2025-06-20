import { Command, GroupReaderType, Task, TaskType } from "@netapp-cloud-datamigrate/jobs-lib";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "src/redis/redis.service";
import { buildTask } from "../utils/utils";
import * as crypto from "crypto";



@Injectable()
export class MigrateCommonService {

  readonly batchOfCommands: number = 10;

  constructor(
      private readonly logger: Logger,
      private readonly redisService: RedisService,
    ) {}

    calculateHash(commands: Command[]): string {
        const commandIds = commands.map(cmd => cmd.commandId);
        commandIds.sort(); // Sort to ensure consistent order
        const concatenatedIds = commandIds.join(',');
        return crypto.createHash('sha256'). update(concatenatedIds).digest('hex');

    }

    async getGroupOfTasksActivity(jobRunId,  groupSize =1000): Promise<string[]> {
    let taskIds: string[] = [];
      try{
        const jobContext = await this.redisService.getJobManagerContext(jobRunId);
        let commands:Command[] = [], streamIds = [];
        for await (const {data, id} of jobContext.groupReadCommandStream(jobRunId, groupSize, GroupReaderType.WORKER)) {
          commands.push(data);
          streamIds.push(id);
          if (commands.length >= 100) {
            const task = buildTask(TaskType.MIGRATE, jobRunId, jobContext, commands);
            taskIds.push(task.id);
            const hashKey = this.calculateHash(commands); 
            await jobContext.setTask(hashKey, task);            
            commands = [];
          }
        }
        if (commands.length > 0) {
          const task = buildTask(TaskType.MIGRATE, jobRunId, jobContext, commands);
          taskIds.push(task.id);
          const hashKey = this.calculateHash(commands); 
           await jobContext.setTask(hashKey, task);   
          commands = [];
        }
        if(streamIds.length > 0) 
          await jobContext.groupAckCommandStream(streamIds, GroupReaderType.WORKER);
      }catch (error) {
        this.logger.error(`Error in getGroupOfTasksActivity: ${error.message}`, error.stack);
      }
      return taskIds;
    }

    
    
}
