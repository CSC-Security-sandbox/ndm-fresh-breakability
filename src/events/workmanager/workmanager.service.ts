import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { JobRunStatus, JobType, OperationStatus, OperationType, TaskStatus, TaskType } from "src/constants/enums";
import { EmitterEvents } from "src/constants/events";
import { SocketEvents } from "src/constants/status";
import { OperationsEntity } from "src/entities/operation.entity";
import { TaskEntity } from "src/entities/task.entity";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import { jobTypeToOperationType, operationsTypeToTaskType } from "src/utils/mapper";
import { In, Not, Repository } from "typeorm";
import { UnScannedRes } from "../events.type";
import { buildScanPayload,buildMigrationPayload } from "./workmanager.mapper";
import { MountedStatus, ScanCompletedPayload, TaskEventPayload, TaskPayload, WorkerJobRuns } from "./workmanager.types";
import { ConfigService } from "@nestjs/config";
import { VolumeEntity } from "src/entities/volume.entity";


@Injectable()
export class WorkManager{
    private readonly logger: Logger = new Logger(WorkManager.name);
    constructor(
        @InjectRepository(OperationsEntity)
        private operationsRepo: Repository<OperationsEntity>,
        @InjectRepository(TaskEntity)
        private taskRepo: Repository<TaskEntity>,
        @InjectRepository(WorkerJobRunMap)
        private workerJobRunMapRepo: Repository<WorkerJobRunMap>,
        private volumeRepo: Repository<VolumeEntity>,
        private readonly configService: ConfigService,
        private readonly eventEmitter: EventEmitter2,
    ){}
    
    // --------------------------- Create init Operation --------------------------------//
    @OnEvent(EmitterEvents.CREATE_TASK, { async: true })
    async createInitDiscovery(payload: TaskEventPayload){
        await this.createTaskForJobRun(payload)
    }

    async createTaskForJobRun(payload:TaskEventPayload) {
        try{
            const sourceVolume = await this.volumeRepo.findOne({where: {id: payload.details.connection.sourceCredential?.pathId}})
            const targetVolume = await this.volumeRepo.findOne({where: {id: payload.details.connection.targetCredential?.pathId}})
            if(!sourceVolume || !targetVolume) {
                this.logger.error(`Volume not found for Source : ${payload.details.connection.sourceCredential?.pathId} | Target : ${payload.details.connection.targetCredential?.pathId}`)
                return
            }
            const mountBasePath = this.configService.get<string>('app.paths.mountBasePath');
            const sourcePath =  `${mountBasePath}/${payload.jobRunId}/${payload.details.connection.sourceCredential?.pathId}`
            //const sourcePath =  `${mountBasePath}`
            const targetPath =  `${mountBasePath}/${payload.jobRunId}/${payload.details.connection.targetCredential?.pathId}`
            //const targetPath =  `${mountBasePath}/${payload.jobRunId}`
             this.logger.log(`Source Path : ${sourcePath} | Target Path : ${targetPath}`)
            const request =  payload.details.jobType===JobType.DISCOVER ? buildScanPayload(this.buildFilepath(sourcePath,sourceVolume?.volumePath)) : buildMigrationPayload(this.buildFilepath(sourcePath,sourceVolume?.volumePath),this.buildFilepath(targetPath,targetVolume?.volumePath))  
            const operation = this.operationsRepo.create({
                jobRunId: payload.jobRunId,
                status: OperationStatus.READY,
                fPath: sourceVolume?.volumePath,
                sPathId: payload.details.connection.sourceCredential?.pathId,
                tPathId: payload.details.connection.targetCredential?.pathId,
                retryCount: 0,
                operationType: jobTypeToOperationType(payload.details.jobType),
                request: request
            })
           return await this.operationsRepo.save(operation)
       
        }catch(e){
            this.logger.error(e)
        }

    }

    buildFilepath = (path: string, volumePath: string) => { 
        return `${path}/${volumePath}`
    }

    // ------------------------------- Update Worker Mount Status -----------------------------------//
    async updateMountStatus(payload: MountedStatus, isPathMounted: boolean ) {
        await this.workerJobRunMapRepo.update(
            {workerId: payload.workerId, jobRunId: payload.jobRunId},
            {isPathMounted}
        )
        this.logger.debug(`Path Mount status for worker : ${payload?.workerId} | JobRun Id : ${payload?.jobRunId} | IsMounted : ${isPathMounted}`)
    }  

    // --------------------------- Create Un-Scanned Operation --------------------------------//
    createUnScannedTask = async(data:UnScannedRes) => {
        try{
            const operations = data.paths.map(path=>this.operationsRepo.create({
                jobRunId: data.jobRunId,
                status: OperationStatus.READY,
                fPath: path,
                retryCount: 0,
                operationType: OperationType.SCAN,
                request: buildScanPayload(path)
            }))
            await this.operationsRepo.save(operations)
            const workers = await this.workerJobRunMapRepo.find({where: {jobRunId: data.jobRunId}, select: {workerId: true}})
            // Notify worker
            workers.forEach(async worker => {
                this.eventEmitter.emit(EmitterEvents.NOTIFY_WORKER, {
                    workerId: worker.workerId,
                    socketEvents: SocketEvents.WAKE_UP,
                    payload: { jobRunId: data.jobRunId}
                })
            }) 
        }catch(error) {
            this.logger.error(`Error Occurred During Creating UN_SCANNED Operations for Job_Run ${data.jobRunId} worker `)
        }
    }

    // --------------------------- Assign Work --------------------------------//
    assignWork = async (workerId: string) => {
        const jobRunsMapEntity = await this.workerJobRunMapRepo
        .createQueryBuilder('workerJobRunMap')
        .select([
            'workerJobRunMap',
            'jobRun',
            'options',
            'jobConfig.sourcePathId',
            'jobConfig.targetPathId',
        ])
        .leftJoin('workerJobRunMap.jobRun', 'jobRun')
        .leftJoin('jobRun.jobConfig', 'jobConfig')
        .leftJoin('jobRun.options', 'options')
        .where('workerJobRunMap.isActive = :isActive', { isActive: true })
        .andWhere('workerJobRunMap.workerId = :workerId', { workerId })
        .andWhere('workerJobRunMap.isPathMounted = true')
        .getMany();

        const jobRun: WorkerJobRuns[] = jobRunsMapEntity.map((it) => ({
            jobRunId: it.jobRunId,
            sPathId: it.jobRun?.jobConfig?.sourcePathId,
            tPathId: it.jobRun?.jobConfig?.targetPathId,
            status: it.jobRun?.status,
            options: it.jobRun.options,
        }))

        for(const job of jobRun) {
            const task = await this.createTask(job, workerId)
            if(task) {
                if(job.status === JobRunStatus.Ready)
                    this.eventEmitter.emit(EmitterEvents.JOB_RUN_STATUS_UPDATE, {
                        jobRunId: job.jobRunId,
                        status: JobRunStatus.Running
                    })
                return task
            }
        }
        return undefined
    }

    // --------------------------- Create Work --------------------------------//
    async createTask(jobRun: WorkerJobRuns, workerId: string) {
        return await this.taskRepo.manager.transaction(async transaction=>{
            const operations: OperationsEntity[] = await transaction
            .createQueryBuilder(OperationsEntity, 'operation')
            .setLock('pessimistic_write')
            .select(['operation.fPath', 'operation.request','operation.id', 'operation.operationType', 'operation.status', 'operation.retryCount', 'operation.errorDetails'])
            .where('operation.jobRunId = :jobRunId', {jobRunId: jobRun.jobRunId})
            .andWhere('operation.status = :status',{ status: OperationStatus.READY})
            .limit(500).getMany()

            if(operations.length === 0)
                return undefined

            const taskEntity : TaskEntity = this.taskRepo.create({
                jobRunId: jobRun.jobRunId,
                taskType: operationsTypeToTaskType(operations[0].operationType),
                status: TaskStatus.Pending,
                workerId: workerId
            })
            
            const savedTask = await transaction.save(TaskEntity, taskEntity);

            await transaction.update(
              OperationsEntity,
              { id: In(operations.map((op) => op.id)) },
              { taskId: savedTask.id , status: OperationStatus.IN_PROCESS},
            );

            return this.buildTaskPayload(savedTask, operations, jobRun);
        })
    }

    
    buildTaskPayload = (task: TaskEntity, operation: OperationsEntity[], jobRun: WorkerJobRuns): TaskPayload => {
        return ({
            id: task.id,
            jobRunId: task.jobRunId,
            sPath: jobRun.sPathId,
            taskType: task.taskType,
            status: task.status,
            workerId: task.workerId,
            tPath: jobRun.tPathId,
            excludeFilePatterns: jobRun.options?.excludeFilePatterns,
            sourceWorkingDir: jobRun.options?.sourceWorkingDir,
            targetWorkingDir: jobRun.options?.targetWorkingDir,
            commands : operation.map(op=> op.request),
        })
    }

    // -------------------------- Task Update --------------------------------- //
    updateTask = async (task: ScanCompletedPayload) => {
        await this.updateScanTask(task)
    }

    // -------------------------- Scan Task Update --------------------------------- //
    updateScanTask = async (task: ScanCompletedPayload) => {
        const successOperations: string[] = []
        let isErrored: boolean = false
        for(const op of task.commands) {
            if(op.ops["0"].status === OperationStatus.COMPLETED) {
                successOperations.push(op.fPath)
                continue;
            }
            await this.operationsRepo.update(
                {fPath: op.fPath, taskId: task.id}, {status : OperationStatus.ERROR, errorDetails: op.ops["0"].error}
            )
            isErrored=true
        }
        await this.operationsRepo.update(
            {fPath: In(successOperations), taskId: task.id}, {status : OperationStatus.COMPLETED}
        )
        await this.taskRepo.update({id: task.id}, {status: task.status})

        if(!isErrored && task.status === TaskStatus.Completed){
            const isNotCompletedOperation = await this.operationsRepo.findOne({where: {jobRunId: task.jobRunId, status: Not(OperationStatus.COMPLETED)}})
            const isNotCompletedTask = await this.taskRepo.findOne({where: {jobRunId: task.jobRunId, status: Not(TaskStatus.Completed)}})
            if(!isNotCompletedOperation && !isNotCompletedTask)  
                this.onTaskComplete(task)
            
        }
    }

    async onTaskComplete(task: ScanCompletedPayload) {
        this.eventEmitter.emit(EmitterEvents.JOB_RUN_STATUS_UPDATE, {
            jobRunId: task.jobRunId,
            status: JobRunStatus.Completed
        })    
        this.eventEmitter.emit(EmitterEvents.UNMOUNT_NOTIFICATION, {
            jobRunId: task.jobRunId,
            sPathId: task.sPath,
            tPathId: task?.tPath
        })
        this.logger.debug(`=====================================================================================================\n                      Congratulation ${task.jobRunId} IS COMPLETED \n=====================================================================================================`)
        switch(task.taskType) {
            case TaskType.Scan:
                this.eventEmitter.emit(EmitterEvents.DISCOVERY_COMPLETE, {
                    jobRunId: task.jobRunId,
                })
                break;
            default: return  
        }
    }

}