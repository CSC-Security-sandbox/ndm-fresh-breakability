import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Protocol } from 'src/constants/enums';
import { Operations, ResponseStatus, SocketEvents, TaskType } from 'src/constants/status';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { FindManyOptions, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { WorkerRequestDTO } from '../dto/responsefilter.dto';

import { ValidateConnectionDto } from '../dto/validateconnection.dto';
import { QueueEvent, ValidateConnectionOptionReq, ValidateConnectionReq } from '../events.type';
import { FileConfigService } from './config.service';
import { RabbitMqService } from './rabbitmq.service';


@Injectable()
export class EventsService {
    private logger : Logger = new Logger(EventsService.name);
    constructor(
        @InjectRepository(RequestTrackEntity)
        private readonly requestTrackEntity: Repository<RequestTrackEntity>,
        private rabbitMqService: RabbitMqService,
        private readonly fileConfigService: FileConfigService

    ) {}

    baseValidateConnectionReq = (details: ValidateConnectionDto, transactionId: string):ValidateConnectionReq => ({
        id: transactionId,
        status: ResponseStatus.PENDING,
        taskType: TaskType.VALIDATE_CONNECTION,
        transactionId: transactionId,
        workerId: '',
        operations: details.protocols.map((it): ValidateConnectionOptionReq => ({
            operation: it.protocol == Protocol.NFS ? Operations.VALIDATE_NFS_CONNECTION : Operations.VALIDATE_SMB_CONNECTION,
            request: {
                hostname: it.username,
                username: it.username,
                password: it.password
            },
            status: ResponseStatus.PENDING,
        }))
    })

    async validateWorkerConnection(details: ValidateConnectionDto) {
        const transactionId = uuidv4(); 
        const base = this.baseValidateConnectionReq(details, transactionId);
        details.workers.forEach(async (worker)=> {
            details.protocols.forEach(async (protocolInfo)=> {
                const requestTrack = this.requestTrackEntity.create({
                    transactionId, status: ResponseStatus.PENDING,  
                    taskType: TaskType.VALIDATE_CONNECTION,
                    workerId: worker, createdBy: transactionId,
                    operation: protocolInfo.protocol == Protocol.NFS ? Operations.VALIDATE_NFS_CONNECTION : Operations.VALIDATE_SMB_CONNECTION,
                })
                await this.requestTrackEntity.save(requestTrack)
            })
            this.notifyEventToWorker(worker, SocketEvents.VALIDATE_CONNECTION, {...base, workerId: worker})
        })
        return {requestId: transactionId}
    }



    async notifyEventToWorker(workerId:string, socketEvents: SocketEvents, payload: any) {
        const queueEvent:QueueEvent = {
            workerId: workerId,
            action: {
                eventType: socketEvents,
                message: payload
            }
        }
        this.rabbitMqService.publishToExchange(queueEvent)
        this.logger.log(`${socketEvents} is published for ${workerId}`)
    }

    async processWorkerResponses(workerRequestDTO: WorkerRequestDTO) {
        const { page, limit, sort = 'createdAt', order = 'ASC', deserialize , ...filter } = workerRequestDTO;
        
        const findOptions: FindManyOptions<RequestTrackEntity> = {
          where: filter, order: { [sort]: order }, 
        };
        let data = [], total = 0;
        if (page && limit) {
          findOptions.skip = (parseInt(page) - 1) * parseInt(limit); 
          findOptions.take = parseInt(limit); 
          data = await this.requestTrackEntity.find(findOptions);
          total = await this.requestTrackEntity.count({ where: filter });
        } else {
          data = await this.requestTrackEntity.find(findOptions);
          total = await this.requestTrackEntity.count();
        }
        if(deserialize) 
            data = data.map((it:RequestTrackEntity) => ({...it, response: it?.response ? JSON.parse(it?.response ?? "") : ""}))
        return { data, total };
      }

      // Send fetch path event to worker
      async fetchPaths(configId: string) {
        const config =  await this.fileConfigService.getPathConfig(configId)
        if(!config) 
            throw new NotFoundException(`Config with ${configId} configId does not exists.`)
        config.fileServers.forEach(async server=> {
            const payload = {configId: config.id, protocol: server.protocol}
            server.workers.forEach(async worker=> {
                await this.notifyEventToWorker(worker.workerId, SocketEvents.Volumes, payload)
            })
        })
        return await this.fileConfigService.updateRefetchingConfig(config)
      }
}
