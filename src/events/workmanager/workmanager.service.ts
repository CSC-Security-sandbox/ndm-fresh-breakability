import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { JobRunStatus, OperationStatus, OperationType, TaskStatus, TaskType } from "src/constants/enums";
import { EmitterEvents } from "src/constants/events";
import { SocketEvents } from "src/constants/status";
import { OperationsEntity } from "src/entities/operation.entity";
import { TaskEntity } from "src/entities/task.entity";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import { jobTypeToOperationType, operationsTypeToTaskType } from "src/utils/mapper";
import { In, Not, Repository } from "typeorm";
import { UnScannedRes } from "../events.type";
import { buildScanPayload } from "./workmanager.mapper";
import { MountedStatus, ScanCompletedPayload, TaskEventPayload, TaskPayload, WorkerJobRuns } from "./workmanager.types";
import { ConfigService } from "@nestjs/config";


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
        private readonly configService: ConfigService,
        private readonly eventEmitter: EventEmitter2,
    ){}
    
    // --------------------------- Create init Operation --------------------------------//
    @OnEvent(EmitterEvents.TaskCreate, { async: true })
    async createInitDiscovery(payload: TaskEventPayload){
        try{
            const mountBaseDir = this.configService.get<string>('app.paths.mountBaseDir');
            const path =  `${mountBaseDir}/${payload.jobRunId}/${payload.details.connection.sourceCredential?.pathId}`
            this.logger.error(path)
            const request =  buildScanPayload(path)
            const operation = this.operationsRepo.create({
                jobRunId: payload.jobRunId,
                status: OperationStatus.READY,
                fPath: path,
                sPathId: payload.details.connection.sourceCredential?.pathId,
                tPathId: payload.details.connection.targetCredential?.pathId,
                retryCount: 0,
                operationType: jobTypeToOperationType(payload.details.jobType),
                request: request
            })
            await this.operationsRepo.save(operation)
       
        }catch(e){
            this.logger.error(e)
        }
    }

    // ------------------------------- Update Worker Mount Status -----------------------------------//
    async updateMountStatus(payload: MountedStatus) {
        await this.workerJobRunMapRepo.update(
            {workerId: payload.workerId, jobRunId: payload.jobRunId},
            {isPathMounted: true}
        )
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
                this.eventEmitter.emit(EmitterEvents.NotifyWorker, {
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
                    this.eventEmitter.emit(EmitterEvents.JobRunStatusUpdate, {
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
        await this.taskRepo.update({id: task.id}, {status: TaskStatus.Completed})

        if(!isErrored){
            const isNotCompletedOperation = await this.operationsRepo.findOne({where: {jobRunId: task.jobRunId, status: Not(OperationStatus.COMPLETED)}})
            const isNotCompletedTask = await this.taskRepo.findOne({where: {jobRunId: task.jobRunId, status: Not(TaskStatus.Completed)}})
            // this.logger.warn(isNotCompletedOperation,isNotCompletedTask, task.id)
            if(!isNotCompletedOperation && !isNotCompletedTask)  {
                this.eventEmitter.emit(EmitterEvents.JobRunStatusUpdate, {
                    jobRunId: task.jobRunId,
                    status: JobRunStatus.Completed
                })             
                this.logger.debug(`=====================================================================================================\n                      Congratulation ${task.jobRunId} IS COMPLETED \n=====================================================================================================`)
                this.onTaskComplete(task)
            }
        }
    }

    async onTaskComplete(task: ScanCompletedPayload) {
        this.logger.debug(task)
        switch(task.taskType) {
            case TaskType.Scan:
                this.logger.debug('Sending Message Handler Called !')
                this.eventEmitter.emit(EmitterEvents.DiscoveryComplete, {
                    jobRunId: task.jobRunId,
                })
                break;
            default: return  
        }
    }
}