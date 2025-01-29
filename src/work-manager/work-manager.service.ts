import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkerConfiguration } from 'src/constants/types';
import { WorkerEntity } from 'src/entities/worker.entity';
import { Repository } from 'typeorm';
import { WorkerStatus, WorkFlows, WorkFlowType } from 'src/constants/enums';
import { CreateRequestDto } from './dto/validate-connection.dto';
import { WorkflowService } from 'src/workflow/workflow.service';
import { StartWorkFlowPayload } from 'src/workflow/workflow.types';
import { ConfigService } from '@nestjs/config';


@Injectable()
export class WorkManagerService {
    readonly logger : LoggerService
    constructor(
        @InjectRepository(WorkerEntity)
        private readonly workerEntity: Repository<WorkerEntity>,
        private loggerFactory: LoggerFactory,
        private readonly workFlowService: WorkflowService,
        private readonly configService: ConfigService
    ) {
        this.logger = this.loggerFactory.create(WorkManagerService.name)
    }

    async getConfiguration(id: string, ip: string, projectId: string, workerName:string): Promise<WorkerConfiguration[]> {
        const worker = await this.workerEntity.findOne({where: {workerId: id}})
        if(worker)
            return worker.metaConfig
        const rawWorker = this.workerEntity.create({
            workerId: id,
            ipAddress: ip,
            metaConfig: this.createWorkerConfiguration(id),
            status: WorkerStatus.Online,
            workerName: workerName,
            createdBy: id,
            projectId: projectId
        })
        const result = await this.workerEntity.save(rawWorker)
        return result.metaConfig
    }

    createWorkerConfiguration = (workerId: string) : WorkerConfiguration[] => [
        {
            configName: WorkFlowType.PARENT_WORKFLOW,
            dynamicTaskQueue:false,
            taskQueueId: null,
            workerId: workerId
        },
        {
            configName: WorkFlowType.WORKER_SPECIFIC_WORKFLOW,
            dynamicTaskQueue:true,
            taskQueueId: workerId,
            workerId: workerId
        }
    ] 

    async validateConnection(payload: CreateRequestDto, traceId: string ) {
        const startWorkFlowPayload: StartWorkFlowPayload = {
            workflowId: WorkFlows.VALIDATE_CONNECTION + '-' + traceId,
            taskQueue: 'ParentWorkflow-TaskQueue',
            args: [{ traceId: traceId, payload: {
                    traceId,
                    feature: this.configService.get('app.feature'), 
                    ...payload
                }, 
                options: payload.options
             }],
            ...payload.options
        }

        this.logger.log('-----------------------------------------')
        this.logger.log( JSON.stringify(this.configService.get('app.feature')) )
        this.logger.log('-----------------------------------------')
        const workflow = await this.workFlowService.startWorkflow(WorkFlows.VALIDATE_CONNECTION, startWorkFlowPayload)
        return {workflowId : workflow.workflowId}
    }

    async getChildWorkFlowRes(id: string) {
        return this.workFlowService.getWorkFlowRes(id)
    }
}
