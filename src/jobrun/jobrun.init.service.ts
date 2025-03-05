import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Command,
  FileServerDetails,
  JobConfig,
  SpeedTestJobConfig,
  JobContextFactory,
  NFS,
  RedisUtils,
  SMB,
  Task,
} from '@netapp-cloud-datamigrate/jobs-lib';
import { JobStatus as JobContextStatus, OPS_CMD, OPS_STATUS, TaskStatus, TaskType } from "@netapp-cloud-datamigrate/jobs-lib/dist/types/enums";
import { JobState } from "@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state";
import { WorkflowHandleWithFirstExecutionRunId } from "@temporalio/client";
import axios from 'axios';
import { ConsumerType, JobRunStatus, JobStatus, JobType, Protocol, WorkFlows } from "src/constants/enums";
import { ScheduleStatus } from "src/constants/status";
import { Options } from "src/constants/types";
import { JobConfigEntity, SpeedTestConfigEntity, SpeedTestConfigWorkerEntity } from "src/entities/jobconfig.entity";
import { JobOptionsEntity } from "src/entities/joboptions.entity";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import { WorkflowService } from "src/workflow/workflow.service";
import { StartWorkFlowPayload } from "src/workflow/workflow.types";
import { LessThan, Repository } from "typeorm";
import { v4 as uuid4 } from 'uuid';
import { JobRunEntity } from "../entities/jobrun.entity";
import { JobRunConfig } from "./jobrun.types";
import { RedisService } from "src/redis/redis.service";
import { FileServerEntity } from "src/entities/fileserver.entity";

@Injectable()
export class JobRunInitService { 
  private readonly logger = new Logger(JobRunInitService.name);
  private readonly mountBasePath: string 

  constructor(
    @InjectRepository(JobRunEntity)
    private jobRunRepo: Repository<JobRunEntity>,
    @InjectRepository(SpeedTestConfigEntity)
    private SpeedTestConfigRepo: Repository<SpeedTestConfigEntity>,
    @InjectRepository(SpeedTestConfigWorkerEntity)
    private SpeedTestConfigWorkerRepo: Repository<SpeedTestConfigWorkerEntity>,
    @InjectRepository(JobConfigEntity)
    private jobConfigRepo: Repository<JobConfigEntity>,
    @InjectRepository(FileServerEntity)
    private fileServerRepo: Repository<FileServerEntity>,
    @InjectRepository(WorkerJobRunMap)
    private workerJobRunMapRepo: Repository<WorkerJobRunMap>,
    @InjectRepository(JobOptionsEntity)
    private optionRepo: Repository<JobOptionsEntity>,
    @Inject()
    private workFlowService: WorkflowService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService
  ) {
    this.mountBasePath = this.configService.get<string>('app.paths.mountBasePath')
  }


   
  // ------------------ Cron schedule -------------------- //
  async scheduleAJob() {
    const currentTime = new Date();
    const jobs: JobConfigEntity[] = await this.jobConfigRepo.find({
      select:{id: true},
      where: {
        status: JobStatus.Active, scheduler: ScheduleStatus.SCHEDULING, 
        firstRunAt: LessThan(currentTime)
      },
    })
    for(const job of jobs)
      await this.createJobRun(job.id, currentTime)
    return jobs;
  }

   // ------------------ Create job run  -------------------- //
   async createJobRun(jobConfigId: string , currentTime: Date) {
    const details:JobRunConfig = await this.getJobConfig(jobConfigId)
    console.log('details--->', JSON.stringify(details)) 
    
    if(details.workers.length === 0) {
      this.logger.warn(`Unable to create Job Run for Job Config ${jobConfigId} does not has workers`)
      return
    }
    const workerMap = details.workers.map((worker) =>
      this.workerJobRunMapRepo.create({ workerId: worker, isActive: true, isPathMounted: false })
    )

    const options = this.optionRepo.create({
      excludeFilePatterns: details.excludeFilePatterns,
      sourceWorkingDir: this.mountBasePath,
      targetWorkingDir: this.mountBasePath,
      preserveAccessTime: details.preserveAccessTime,
      excludeOlderThan: details.excludeOlderThan
    })
    const jobRunRecord = this.jobRunRepo.create({
      status: JobRunStatus.Ready,
      startTime: currentTime,
      endTime: null,
      iterationNumber: 1,
      jobConfigId: jobConfigId,
      workerMap: workerMap,
      options: options,
    });
    const jobRun = await this.jobRunRepo.save(jobRunRecord);
    await this.jobConfigRepo.update({id: jobConfigId}, {scheduler: ScheduleStatus.SCHEDULED});
    if (details.jobType == JobType.SPEED_TEST){
      await this.buildSpeedTestJobContext(jobRun.id, details);
    }
    else{
      await this.buildJobContext(jobRun.id, details);
    }
    await this.initiateWorkflow(jobRun.id, details);
    return jobRun
  }

  async getJobConfigSpeedTest(
    jobConfigId
  ): Promise<JobRunConfig> {
    const jobConfig = await this.jobConfigRepo.findOne({
      where : {id: jobConfigId},
      relations: {
        speedTestConfigs: {
          workerEntities: true
        },
      },
    })
    const workers = jobConfig?.speedTestConfigs?.flatMap((config) => config.workerEntities.map(worker => worker.workersId)) || [];

    const details : JobRunConfig = {
      preserveAccessTime: jobConfig.preserveAccessTime,
      excludeFilePatterns: jobConfig.excludeFilePatterns,
      excludeOlderThan: jobConfig.excludeOlderThan,
      connection: {
        sourceCredential: {
          path: jobConfig?.sourcePath?.volumePath ,
          pathId : jobConfig?.sourcePath?.id ,
          protocol: jobConfig?.sourcePath?.fileServer?.protocol,
          username: jobConfig?.sourcePath?.fileServer?.userName,
          password: jobConfig?.sourcePath?.fileServer?.password,
          host: jobConfig?.sourcePath?.fileServer?.host,
          workingDirectory: this.mountBasePath
        }
      },
      workers: workers,
      jobType: jobConfig.jobType
    }
    return details
  }

    // ------------------ Get list of workers -------------------- //
    async getJobConfig(
        jobConfigId
      ): Promise<JobRunConfig> {
        const jobConfig = await this.jobConfigRepo.findOne({
          where : {id: jobConfigId},
          relations: {
            sourcePath: { fileServer: { config: true, workers:true } },
            targetPath: { fileServer: { config: true, workers:true } }
          },
        })
        if (jobConfig.jobType===JobType.SPEED_TEST) {
          return  this.getJobConfigSpeedTest(jobConfigId)
        }
        const sourceWorkers = jobConfig?.sourcePath?.fileServer?.workers || [];
        const targetWorkers = jobConfig?.targetPath?.fileServer?.workers || [];
    
        const details : JobRunConfig = {
          preserveAccessTime: jobConfig.preserveAccessTime,
          excludeFilePatterns: jobConfig.excludeFilePatterns,
          excludeOlderThan: jobConfig.excludeOlderThan,
          connection: {
            sourceCredential: {
              path: jobConfig?.sourcePath?.volumePath ,
              pathId : jobConfig?.sourcePath?.id ,
              protocol: jobConfig?.sourcePath?.fileServer?.protocol,
              username: jobConfig?.sourcePath?.fileServer?.userName,
              password: jobConfig?.sourcePath?.fileServer?.password,
              host: jobConfig?.sourcePath?.fileServer?.host,
              workingDirectory: this.mountBasePath,
              protocolVersion: jobConfig?.sourcePath?.fileServer?.protocolVersion.replace(/^v/, ''),
            }
          },
          workers: sourceWorkers.map((worker) => worker.workerId),
          jobType: jobConfig.jobType,
          skipFile: jobConfig.skipFile
        }
    
        if (jobConfig.targetPathId) {
          const workers: string[] = [];
          const workerSet = new Set<string>();
          sourceWorkers.forEach((worker) => workerSet.add(worker.workerId));
          targetWorkers?.forEach((worker) => {
            if (workerSet.has(worker.workerId)) workers.push(worker.workerId);
          });
    
          details.connection['targetCredential'] = {
            path: jobConfig?.targetPath?.volumePath ,
            pathId : jobConfig?.targetPath?.id ,
            protocol: jobConfig?.targetPath?.fileServer?.protocol ,
            username: jobConfig?.targetPath?.fileServer?.userName,
            password: jobConfig?.targetPath?.fileServer?.password,
            host: jobConfig?.targetPath?.fileServer?.host,
            workingDirectory: this.mountBasePath,
            protocolVersion: jobConfig?.targetPath?.fileServer?.protocolVersion.replace(/^v/, ''),
          }
          details['workers'] = workers
          return details;
        }
        return details
    }
    async getFileServerDetails(jobRunId): Promise<any> {
      const jobRun = await this.jobRunRepo.findOne({
        where: { id: jobRunId },
        relations: ['jobConfig'],
      });
      if (!jobRun) {
        throw new Error(`JobRun with id ${jobRunId} not found`);
      }
      const jobConfigId = jobRun.jobConfigId;

      const speedTestJobConfig = await this.SpeedTestConfigRepo.find({
        where: { jobId: jobConfigId },
        relations: ['workerEntities', 'jobConfig'],
      });

      const fileServers = await this.fileServerRepo.find({
        relations: ['config', 'volumes', 'workingDirectory', 'workers']
      });
     
      const mergedResults = speedTestJobConfig.map(config => {
        const fileServer = fileServers.find(server => server.id === config.fileServer);
  
        return {
          ...config,
          fileServerDetails: fileServer ? {
            fileServerId: fileServer.id,
            host: fileServer.host,
            userName: fileServer.userName,
            password: fileServer.password,
            fileServerProtocol: fileServer.protocol,
            fileServerName: fileServer.config.configName,
            volumes: fileServer.volumes[0],
            workingDirectory: fileServer.workingDirectory,
            workers: fileServer.workers
          } : null
        };
      });

     return mergedResults
    }
    // ------------------ InitiateWorkflow -------------------- //
    async initiateWorkflow(jobRunId: string, jobRunConfig: JobRunConfig) {

        let jobRunWorkflow: WorkflowHandleWithFirstExecutionRunId | null = null ;
        const options = new Options()
        options.workflowExecutionTimeout = '120s'
        options.workflowTaskTimeout = '120s'
        options.workflowRunTimeout = '120s'
        switch (jobRunConfig.jobType) {  
          case JobType.DISCOVER: {
            const startWorkFlowPayload: StartWorkFlowPayload = {
                workflowId: WorkFlows.DISCOVERY + '-' + jobRunId,
                taskQueue: 'ParentWorkflow-TaskQueue',
                args: [{ traceId: jobRunId, payload: jobRunConfig, options: options }],
                options:options
              }
            jobRunWorkflow = await this.workFlowService.startWorkflow(WorkFlows.DISCOVERY, startWorkFlowPayload)
            break;
          }
          case JobType.SPEED_TEST: {
            const speedTestJobConfig = await this.getFileServerDetails(jobRunId);
            // const jobRun = await this.jobRunRepo.findOne({
            //   where: { id: jobRunId },
            //   relations: ['jobConfig'],
            // });
            // if (!jobRun) {
            //   throw new Error(`JobRun with id ${jobRunId} not found`);
            // }
            // const jobConfigId = jobRun.jobConfigId;
            // const speedTestJobConfig = await this.SpeedTestConfigRepo.find({
            //   where: { jobId: jobConfigId },
            //   relations: ['workerEntities', 'jobConfig'],
            // });
            const startWorkFlowPayload: StartWorkFlowPayload = {
                workflowId: WorkFlows.SPEED_TEST + '-' + jobRunId,
                taskQueue: 'ParentWorkflow-TaskQueue',
                args: [{ traceId: jobRunId, payload: speedTestJobConfig, options: options }],
                options:options
              }
            jobRunWorkflow = await this.workFlowService.startWorkflow(WorkFlows.SPEED_TEST, startWorkFlowPayload)
            break;
          }

          case JobType.CUT_OVER: {
            const startWorkFlowPayload: StartWorkFlowPayload = {
                workflowId: WorkFlows.CUT_OVER + '-' + jobRunId,
                taskQueue: 'ParentWorkflow-TaskQueue',
                args: [{ traceId: jobRunId, payload: jobRunConfig, options: options }],
                options:options
              }
            jobRunWorkflow = await this.workFlowService.startWorkflow(WorkFlows.CUT_OVER, startWorkFlowPayload)
            await this.jobConfigRepo.update({
                sourcePathId: jobRunConfig.connection.sourceCredential.pathId,
                targetPathId: jobRunConfig.connection.targetCredential.pathId,
                jobType: JobType.MIGRATE
            }, {status: JobStatus.InActive})
            break;
          }

          default: {
            const startWorkFlowPayload: StartWorkFlowPayload = {
                workflowId: WorkFlows.MIGRATE + '-' + jobRunId,
                taskQueue: 'ParentWorkflow-TaskQueue',
                args: [{ traceId: jobRunId, payload: jobRunConfig, options: options }],
                options:options
              }
            jobRunWorkflow = await this.workFlowService.startWorkflow(WorkFlows.MIGRATE, startWorkFlowPayload)
            break;
          }
        }
        await this.startStreamConsumer(jobRunId)
        if (jobRunWorkflow) {
          await this.jobRunRepo.update(
            { id: jobRunId },
            { workFlowId: jobRunWorkflow.workflowId }
          );
          this.logger.log(
            `Starting ${jobRunConfig.jobType} workflow for jobRunId: ${jobRunId}, with workflowId: ${jobRunWorkflow.workflowId}`
          );
        }
    }

        // ------------------ BuildJobContext -------------------- //
        async buildSpeedTestJobContext(jobRunId: string,jobRunConfig:JobRunConfig) {
          // let sourcefileServerDetails: FileServerDetails;
          // let targetfileServerDetails: FileServerDetails;
      
          // const sourceCredential = jobRunConfig.connection.sourceCredential;
          // const targetCredential = jobRunConfig.connection.targetCredential;
      
          // const createFileServerDetails = (credential: any) => {
          //   return credential.protocol === Protocol.NFS
          //     ? new FileServerDetails(credential.host, [new NFS(credential.username)], credential.pathId,credential.path,credential?.username,credential?.password,credential?.workingDirectory)
          //     : new FileServerDetails(credential.host, [new SMB(credential.username, credential.password)],credential.pathId,credential.path,credential?.username,credential?.password,credential?.workingDirectory);
          // };
          // sourcefileServerDetails= createFileServerDetails(sourceCredential);
      
          // if (jobRunConfig.jobType !== JobType.DISCOVER) 
          //   targetfileServerDetails= createFileServerDetails(targetCredential);
          const jobRun = await this.jobRunRepo.findOne({
            where: { id: jobRunId },
            relations: ['jobConfig'],
          });
          if (!jobRun) {
            throw new Error(`JobRun with id ${jobRunId} not found`);
          }
          const jobConfigId = jobRun.jobConfigId;
          const speedTestJobConfig = await this.SpeedTestConfigRepo.find({
            where: { jobId: jobConfigId },
          });
          console.log("!!!!!!!!!!!speedTestJobConfig!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
          

          console.log(speedTestJobConfig);
          const jobConfig = new SpeedTestJobConfig(
            jobRunId,
            jobRunConfig.jobType,
          )

          const redisClient = await RedisUtils.getClient();
          if(!redisClient.isOpen) await redisClient.connect();
          const jobState: JobState = new JobState([], 0, 1, [], JobContextStatus.Pending);
          const jobContext = JobContextFactory.getProvider('redis', this.redisService.getClient())
          .buildContext(jobRunId, jobConfig, JobRunStatus.Ready, jobState);
            // (await jobContext).appendToTaskList(await this.createInitialTask(jobRunId, jobRunConfig));
          this.redisService.setJobContext(jobRunId, await jobContext);
      }

    // ------------------ BuildJobContext -------------------- //
  async buildJobContext(jobRunId: string, jobRunConfig: JobRunConfig) {
    let sourcefileServerDetails: FileServerDetails;
    let targetfileServerDetails: FileServerDetails;

    const sourceCredential = jobRunConfig.connection.sourceCredential;
    const targetCredential = jobRunConfig.connection.targetCredential;

    const createFileServerDetails = (credential: any) => {
      return credential.protocol === Protocol.NFS
        ? new FileServerDetails(credential.host, [new NFS(credential.username)], credential.pathId, credential.path, credential?.username, credential?.password, credential?.workingDirectory, credential.protocolVersion)
        : new FileServerDetails(credential.host, [new SMB(credential.username, credential.password)], credential.pathId, credential.path, credential?.username, credential?.password, credential?.workingDirectory, credential.protocolVersion);
    };
    sourcefileServerDetails = createFileServerDetails(sourceCredential);

    if (jobRunConfig.jobType !== JobType.DISCOVER)
      targetfileServerDetails = createFileServerDetails(targetCredential);

    const jobConfig = new JobConfig(
      jobRunId,
      jobRunConfig.jobType,
      sourcefileServerDetails,
      jobRunConfig.connection.sourceCredential.path,
      jobRunConfig.jobType !== JobType.DISCOVER ? targetfileServerDetails : undefined,
      jobRunConfig.jobType !== JobType.DISCOVER ? jobRunConfig.connection.targetCredential.path : undefined,
      jobRunConfig.workers,
      { excludeFilePattern: jobRunConfig.excludeFilePatterns, preserveAccessTime: jobRunConfig.preserveAccessTime, skipsFilesModifiedInLast: jobRunConfig?.skipFile, excludeOlderThan: !!jobRunConfig.excludeOlderThan ? jobRunConfig.excludeOlderThan.toString() : '' },
    )
    const jobState: JobState = new JobState([], 0, 1, [], JobContextStatus.Pending, []);

    const task = await this.createInitialTask(jobRunId, jobRunConfig);
    const redisProvider = JobContextFactory.getProvider('redis', await this.redisService.getClient());
    const jobContext = await redisProvider.buildContext(jobRunId, jobConfig, JobRunStatus.Ready, jobState);
    await jobContext.appendToTaskList(task);
    console.debug('JobContext created and appended initial task ---> ', task);
    await this.redisService.setJobContext(jobRunId, jobContext);
    console.debug('JobContext Saved to Redis');
  }

    // ------------------ CreateInitialTask -------------------- //
  async createInitialTask(jobRunId: string, jobRunConfig: JobRunConfig): Promise<Task> {
    const commands = new Command('', { 0: { cmd: OPS_CMD.COPY_DIR, status: OPS_STATUS.READY } }, uuid4(), 0)
    const task = new Task(
      uuid4(),
      jobRunId,
      TaskType.SCAN,
      TaskStatus.PENDING,
      jobRunConfig.workers[0],
      `${jobRunConfig.connection.sourceCredential.workingDirectory}/${jobRunId}/${jobRunConfig.connection.sourceCredential.pathId}`,
      jobRunConfig.connection.sourceCredential.pathId,
      [commands],
      jobRunConfig.jobType !== JobType.DISCOVER ? `${jobRunConfig.connection.targetCredential.workingDirectory}/${jobRunId}/${jobRunConfig.connection.targetCredential.pathId}` : '',
      jobRunConfig.jobType !== JobType.DISCOVER ? jobRunConfig.connection.targetCredential.pathId : '',
      jobRunConfig.excludeFilePatterns,
    )
    console.log('Initial Task created ---> ', JSON.stringify(task));
    return task;
  }

    // ------------------ StartStreamConsumer -------------------- //
    async startStreamConsumer (jobRunId:string) {
        const START_CONSUMER_URL = this.configService.get<string>('app.paths.startConsumer');
        for (const consumerType of Object.values(ConsumerType)) {
          const payload = {
            jobRunId: jobRunId,
            readerName: `${consumerType}-reader`,
            consumerType: consumerType,
          };
          try {
            const response = await axios.post(`${START_CONSUMER_URL}/api/v1/redis-consumer/start`, payload);
            this.logger.log(`Started consumer for ${consumerType}:`, response.data);
          } catch (error) {
            this.logger.error(`Failed to start consumer for ${consumerType}:`, error.message);
          }
        }
    }

  getWorkFlowId(jobRunId: string, jobType: JobType): string {
    if(jobType === JobType.DISCOVER) return `${WorkFlows.DISCOVERY}-${jobRunId}`;
    if(jobType === JobType.CUT_OVER) return `${WorkFlows.CUT_OVER}-${jobRunId}`;
    if(jobType === JobType.PRECHECK) return `${WorkFlows.PRECHECK}-${jobRunId}`;
    return `${WorkFlows.MIGRATE}-${jobRunId}`
  }
}
