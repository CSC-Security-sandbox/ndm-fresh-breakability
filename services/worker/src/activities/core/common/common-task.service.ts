import { JobManger } from "@local/job-lib";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Command, CommandStatus, Task, TaskStatus, TaskType } from "@netapp-cloud-datamigrate/jobs-lib";
import { Context } from "@temporalio/activity";
import { Connection } from "@temporalio/client";
import { uuid4 } from "@temporalio/workflow";
import { RetryExceededError } from "src/errors/errors.types";
import { RedisService } from "src/redis/redis.service";
import { buildSyncTask, buildTask, calculateCommandHash } from "../../utils/utils";
import { handleInitTaskInput } from "../migrate/migrate-sync.types";
import { BuildOrGetScanTaskInput } from "./common-task.type";


@Injectable()
export class CommonTaskService {

  readonly workerId: string;
  readonly maxRetryCount: number;

  constructor(
      @Inject(ConfigService) private readonly configService: ConfigService,
      private readonly logger: Logger,
      private readonly jobManager: JobManger
    ) {
      this.workerId = this.configService.get('worker.workerId');
      this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;
    }

    // TO-DO : make this adaptive resource based task creation
    async getGroupOfTasksActivity(jobRunId,  groupSize = 1000): Promise<string[]> {
      const activityContext = Context.current();      
      const heartBeatInterval = setInterval(() => { activityContext.heartbeat({});}, 2000);
      let taskIds: string[] = [];
      const jobConfig = await this.jobManager.getJobConfig(jobRunId);
      try{
        let commands:Command[] = [], streamIds = [];
        for await (const {data, id} of this.jobManager.groupReadCommandStream(jobRunId, groupSize)) {
          commands.push(data);
          streamIds.push(id);
          if (commands.length >= 100) {
            const task = buildSyncTask(TaskType.MIGRATE, jobRunId, jobConfig, commands);
            const hashKey = calculateCommandHash(commands); 
            taskIds.push(hashKey);
             this.logger.debug(`Task created with ID: ${task.id} and hash: ${hashKey}`);
            await this.jobManager.setTaskIfNotExists(jobRunId, hashKey, task);   
            commands = [];
          }
        }
        if (commands.length > 0) {
          const task = buildSyncTask(TaskType.MIGRATE, jobRunId, jobConfig, commands);
          const hashKey = calculateCommandHash(commands); 
          taskIds.push(hashKey);
          this.logger.debug(`Task created with ID: ${task.id} and hash: ${hashKey}`);
          await this.jobManager.setTaskIfNotExists(jobRunId, hashKey, task);   
          commands = [];
        }
        if(streamIds.length > 0) 
          await this.jobManager.groupAckCommandStream(jobRunId, streamIds);
      }catch (error) {
        this.logger.error(`Error in getGroupOfTasksActivity: ${error.message}`, error.stack);
        throw new Error(`Failed to get group of tasks activity: ${error.message}`);
      }finally{
        clearInterval(heartBeatInterval);
      }
      return taskIds;
    }

  
  async buildOrGetValidScanTask({dirToScans, taskHashId , jobRunId}: BuildOrGetScanTaskInput): Promise<Task> {
    let task: Task | undefined = await this.jobManager.getTask(jobRunId, taskHashId);
    if(!task) {
      const jobConfig = await this.jobManager.getJobConfig(jobRunId);
      const commands: Command[] = dirToScans.map(dir => new Command(dir, {}, `${uuid4()}`,0));
      task =  buildSyncTask(TaskType.SCAN, jobRunId, jobConfig, commands);
      await this.jobManager.setTaskIfNotExists(jobRunId, taskHashId, task);
    }
    task = await this.ensureTaskValid({task,jobRunId});
    return task;
  }


  async ensureTaskValid({task , jobRunId}: handleInitTaskInput) : Promise<Task> {
      let retryCount = 0;
      for (let i = 0; i < task.commands.length; i++) {
        retryCount = Math.max(retryCount, task.commands[i].retryCount);
        if (task.commands[i].status !== CommandStatus.COMPLETED)
          task.commands[i].status = CommandStatus.IN_PROCESS
      }
  
      if (retryCount >= this.maxRetryCount) {
        task.status = TaskStatus.ERRORED;
        await this.jobManager.publishToTaskStream(jobRunId,task);
        throw new RetryExceededError(`Task ${task.id} has exceeded maximum retry count of ${this.maxRetryCount}`);
      }
      return task;
  }

  async isWorkflowRunningActivity(workflowId: string): Promise<boolean> {
    const connection = await Connection.connect();
    const namespace = 'default'; // replace with your namespace if different
    const resp = await connection.workflowService.describeWorkflowExecution({
      namespace,
      execution: { workflowId },
    });
    // Status 1 means RUNNING
    return resp.workflowExecutionInfo?.status === 1;
  }

    
}
