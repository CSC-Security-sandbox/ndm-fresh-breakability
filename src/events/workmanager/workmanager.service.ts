import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { ScanCompletedPayload, TaskEventPayload, TaskPayload, WorkerJobRuns } from "./workmanager.types";

import { InjectRepository } from "@nestjs/typeorm";
import { JobType, OperationStatus } from "src/constants/enums";
import { EmitterEvents } from "src/constants/events";
import { OperationsEntity } from "src/entities/operation.entity";
import { TaskEntity, TaskStatus } from "src/entities/task.entity";
import { jobTypeToOperationType, operationsTypeToTaskType } from "src/utils/mapper";
import { In, Repository } from "typeorm";
import { SocketEvents } from "src/constants/status";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";



@Injectable()
export class WorkManager{
    private readonly logger: Logger = new Logger(WorkManager.name)
    constructor(
        @InjectRepository(OperationsEntity)
        private operationsRepo: Repository<OperationsEntity>,
        @InjectRepository(TaskEntity)
        private taskRepo: Repository<TaskEntity>,
        @InjectRepository(WorkerJobRunMap)
        private workerJobRunMapRepo: Repository<WorkerJobRunMap>,
        private readonly eventEmitter: EventEmitter2
    ){}

   

    buildScanPayload =  (payload: TaskEventPayload) => ({
        fPath: payload.sPath,
        ops: {
            0 : {
                cmd : "SCAN_PATH"
            }
        }
    })

    buildRequest = (payload: TaskEventPayload) => {
        switch (payload.taskType){
            case JobType.Scan: 
                return this.buildScanPayload(payload)
            default: return
        }
    }

    @OnEvent(EmitterEvents.TaskCreate, { async: true })
    async createOperation(payload: TaskEventPayload){
        try{
            const request = this.buildRequest(payload)
            const operation = this.operationsRepo.create({
                jobRunId: payload.jobRunId,
                status: OperationStatus.READY,
                fPath: payload.sPath,
                retryCount: 0,
                operationType: jobTypeToOperationType(payload.taskType),
                request: request
            })
            await this.operationsRepo.save(operation)

            // notify to workers
            payload.workers.forEach(worker => {
                this.eventEmitter.emit(EmitterEvents.NotifyWorker, {
                    workerId: worker,
                    socketEvents: SocketEvents.WAKE_UP,
                    payload: { jobRunId: payload.jobRunId}
                })
            })
       
        }catch(e){
            this.logger.error(e)
        }
    }

    assignWork = async (workerId: string) => {
        const jobRunsMapEntity = await this.workerJobRunMapRepo
        .createQueryBuilder('workerJobRunMap')
        .select([
            'workerJobRunMap',
            'jobRun',
            'jobConfig.sourcePathId',
            'jobConfig.targetPathId'
        ])
        .leftJoin('workerJobRunMap.jobRun', 'jobRun',)
        .leftJoin('jobRun.jobConfig', 'jobConfig')
        .where('workerJobRunMap.isActive = :isActive', { isActive: true })
        .andWhere('workerJobRunMap.workerId = :workerId', { workerId })
        .getMany();

        // console.log(jobRunsMapEntity)

        const jobRun: WorkerJobRuns[] = jobRunsMapEntity.map((it) => ({
            jobRunId: it.jobRunId,
            sPathId: it.jobRun?.jobConfig?.sourcePathId,
            tPathId: it.jobRun?.jobConfig?.targetPathId,
        }))

        for(const job of jobRun) {
            const task = await  this.createTask(job, workerId)
            // console.log(job, task)
            if(task) return task
        }
        return undefined
    }

    async createTask(jobRun: WorkerJobRuns, workerId: string) {
        return await this.taskRepo.manager.transaction(async transaction=>{
            const operations: OperationsEntity[] = await transaction
            .createQueryBuilder(OperationsEntity, 'operation')
            .setLock('pessimistic_write')
            .select(['operation.fPath', 'operation.request','operation.id', 'operation.operationType', 'operation.status', 'operation.retryCount', 'operation.errorDetails'])
            .where('operation.jobRunId = :jobRunId', {jobRunId: jobRun.jobRunId})
            .andWhere('operation.status = :status',{ status: OperationStatus.READY})
            .limit(100).getMany()

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
            commands : operation.map(op=> op.request)
        })
    }

    // -------------------------- Task Update --------------------------------- //
    updateTask = async (task: ScanCompletedPayload) => {
        await this.updateScanTask(task)
    }

    // -------------------------- Scan Task Update --------------------------------- //
    updateScanTask = async (task: ScanCompletedPayload) => {
        const successOperations: string[] = [] 
        for(const op of task.commands) {
            if(op.ops["0"].status === OperationStatus.COMPLETED) {
                successOperations.push(op.fPath)
                continue;
            }
            await this.operationsRepo.update(
                {fPath: op.fPath, taskId: task.id}, {status : OperationStatus.ERROR, errorDetails: op.ops["0"].error}
            )
        }
        await this.operationsRepo.update(
            {fPath: In(successOperations), taskId: task.id}, {status : OperationStatus.COMPLETED}
        )
        await this.taskRepo.update({id: task.id}, {status: TaskStatus.Completed})
    }

}