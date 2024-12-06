import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { TaskEventPayload } from "./workmanager.types";

import { InjectRepository } from "@nestjs/typeorm";
import { OperationsEntity } from "src/entities/operation.entity";
import { Repository } from "typeorm";
import { EmitterEvents } from "src/constants/events";
import { OperationStatus } from "src/constants/enums";
import { TaskType } from "src/entities/task.entity";



@Injectable()
export class WorkManager{
    private readonly logger: Logger = new Logger(WorkManager.name)
    constructor(
        @InjectRepository(OperationsEntity)
        private operationsRepo: Repository<OperationsEntity>,
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
            case TaskType.Scan: 
                return this.buildScanPayload(payload)
            default: return
        }
    }

    @OnEvent(EmitterEvents.TaskCreate, { async: true })
    async createTask(payload: TaskEventPayload){
        const request = this.buildRequest(payload)
        const operation = this.operationsRepo.create({
            jobRunId: payload.jobRunId,
            status: OperationStatus.READY,
            fPath: payload.sPath,
            retryCount: 0,
            operationType: payload.taskType,
            request: request
        })
        await this.operationsRepo.save(operation)
    }

}