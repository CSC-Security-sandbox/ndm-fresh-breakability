import { Injectable, Logger } from "@nestjs/common";
import { Command, GroupReaderType, TaskType } from "@netapp-cloud-datamigrate/jobs-lib";
import { RedisService } from "src/redis/redis.service";
import { buildTask, calculateCommandHash } from "../utils/utils";



@Injectable()
export class MigrateCommonService {

  readonly batchOfCommands: number = 10;

  constructor(
      private readonly logger: Logger,
      private readonly redisService: RedisService,
    ) {}

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
            const hashKey = calculateCommandHash(commands); 
            taskIds.push(hashKey);
             this.logger.debug(`Task created with ID: ${task.id} and hash: ${hashKey}`);
            await jobContext.setTaskIfNotExists(hashKey, task);   
            commands = [];
          }
        }
        if (commands.length > 0) {
          const task = buildTask(TaskType.MIGRATE, jobRunId, jobContext, commands);
          const hashKey = calculateCommandHash(commands); 
          taskIds.push(hashKey);
          this.logger.debug(`Task created with ID: ${task.id} and hash: ${hashKey}`);
          await jobContext.setTaskIfNotExists(hashKey, task);   
          commands = [];
        }
        if(streamIds.length > 0) 
          await jobContext.groupAckCommandStream(streamIds, GroupReaderType.WORKER);
      }catch (error) {
        this.logger.error(`Error in getGroupOfTasksActivity: ${error.message}`, error.stack);
        throw new Error(`Failed to get group of tasks activity: ${error.message}`);
      }
      return taskIds;
    }

    
    
}
