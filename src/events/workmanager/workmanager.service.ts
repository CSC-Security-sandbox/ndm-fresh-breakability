import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { TaskEventPayload } from "./workmanager.types";

import { InjectRepository } from "@nestjs/typeorm";
import { JobType, OperationStatus } from "src/constants/enums";
import { EmitterEvents } from "src/constants/events";
import { OperationsEntity } from "src/entities/operation.entity";
import { TaskEntity, TaskStatus } from "src/entities/task.entity";
import { jobTypeToOperationType, operationsTypeToTaskType } from "src/utils/mapper";
import { In, Repository } from "typeorm";
import { SocketEvents } from "src/constants/status";



@Injectable()
export class WorkManager{
    private readonly logger: Logger = new Logger(WorkManager.name)
    constructor(
        @InjectRepository(OperationsEntity)
        private operationsRepo: Repository<OperationsEntity>,
        @InjectRepository(TaskEntity)
        private taskRepo: Repository<TaskEntity>,
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

    async createTask(jobRunId: string) {
        return await this.taskRepo.manager.transaction(async transaction=>{
            const operations: OperationsEntity[] = await transaction
            .createQueryBuilder(OperationsEntity, 'operation')
            .setLock('pessimistic_write')
            .select(['operation.fPath', 'operation.request','operation.id', 'operation.operationType', 'operation.status', 'operation.retryCount', 'operation.errorDetails'])
            .where('operation.jobRunId = :jobRunId', {jobRunId})
            .andWhere('operation.status = :status',{ status: OperationStatus.READY})
            .limit(100).getMany()

            if(operations.length === 0)
                return undefined

            console.debug(operations)

            const taskEntity : TaskEntity = this.taskRepo.create({
                jobRunId: jobRunId,
                taskType: operationsTypeToTaskType(operations[0].operationType),
                status: TaskStatus.Pending,
            })
            
            const savedTask = await transaction.save(TaskEntity, taskEntity);

            await transaction.update(
              OperationsEntity,
              { id: In(operations.map((op) => op.id)) },
              { taskId: savedTask.id , status: OperationStatus.IN_PROCESS},
            );

            return savedTask;
        })
    }



}