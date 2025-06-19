import { Command, GroupReaderType, Task, TaskType } from "@netapp-cloud-datamigrate/jobs-lib";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "src/redis/redis.service";
import { buildTask } from "../utils/utils";



@Injectable()
export class MigrateCommonService {

  readonly batchOfCommands: number = 100;

  constructor(
      private readonly logger: Logger,
      private readonly redisService: RedisService,
    ) {}

    async getGroupOfTasksActivity(jobRunId,  groupSize =1000): Promise<string[]> {
      try{
        const jobContext = await this.redisService.getJobManagerContext(jobRunId);
        let commands:Command[] = [], streamIds = [];
        for await (const {data, id} of jobContext.groupReadCommandStream(jobRunId, groupSize, GroupReaderType.WORKER)) {
          commands.push(data);
          streamIds.push(id);
          if (commands.length >= this.batchOfCommands) {
            const task = buildTask(TaskType.MIGRATE, jobRunId, jobContext, commands);
            await jobContext.taskMap.set(task.id, task);
            commands = [];
          }
        }
        if (commands.length >= 0) {
          const task = buildTask(TaskType.MIGRATE, jobRunId, jobContext, commands);
           await jobContext.taskMap.set(task.id, task);
          commands = [];
        }
        if(streamIds.length > 0) 
          await jobContext.groupAckCommandStream(streamIds, GroupReaderType.WORKER);
      }catch (error) {
        this.logger.error(`Error in getGroupOfTasksActivity: ${error.message}`, error.stack);
      }
      return [];
    }
}
