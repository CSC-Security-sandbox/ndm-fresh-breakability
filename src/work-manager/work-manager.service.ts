import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkerConfiguration } from 'src/constants/types';
import { WorkerEntity } from 'src/entities/worker.entity';
import { Repository } from 'typeorm';
import { WorkFlowType } from './worker-manager.type';
import { WorkerStatus } from 'src/constants/enums';

@Injectable()
export class WorkManagerService {
    private logger : LoggerService
    constructor(
        @InjectRepository(WorkerEntity)
        private readonly workerEntity: Repository<WorkerEntity>,
        private loggerFactory: LoggerFactory
    ) {
        this.logger = this.loggerFactory.create(WorkManagerService.name)
    }

    async getConfiguration(id: string, ip: string, apiKey: string): Promise<WorkerConfiguration[]> {
        const worker = await this.workerEntity.findOne({where: {workerId: id}})
        if(worker)
            return worker.metaConfig
        const rawWorker = this.workerEntity.create({
            workerId: id,
            ipAddress: ip,
            metaConfig: this.createWorkerConfiguration(id),
            status: WorkerStatus.Online,
            workerName: id,
            clientId: ip,
            createdBy: id,
            projectId: apiKey
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
    
}
