import { TaskOperation, TaskStatus, TaskType as TasksType } from './../../constants/enums';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Protocol } from 'src/constants/enums';
import { Operations, ResponseStatus, SocketEvents, TaskType } from 'src/constants/status';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { FindManyOptions, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { WorkerRequestDTO } from '../dto/responsefilter.dto';
import { Credentials, ListPathsMsg } from '../controller/rabbitmq.types';
import { ValidateConnectionDto } from '../dto/validateconnection.dto';
import { ListPathOptionReq, ListPathReq, QueueEvent, ValidateConnectionOptionReq, ValidateConnectionReq } from '../events.type';
import { FileConfigService } from './config.service';
import { RabbitMqService } from './rabbitmq.service';


@Injectable()
export class EventsService {
    private logger: Logger = new Logger(EventsService.name);
    constructor(
        @InjectRepository(RequestTrackEntity)
        private readonly requestTrackEntity: Repository<RequestTrackEntity>,
        private rabbitMqService: RabbitMqService,
        private readonly fileConfigService: FileConfigService,
    ) { }

    async notifyEventToWorker(workerId: string, socketEvents: SocketEvents, payload: any) {
        const queueEvent: QueueEvent = {
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
        const { page, limit, sort = 'createdAt', order = 'ASC', deserialize, ...filter } = workerRequestDTO;

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
        if (deserialize)
            data = data.map((it: RequestTrackEntity) => ({ ...it, response: it?.response ? JSON.parse(it?.response ?? "") : "" }))
        return { data, total };
    }

    // ------------------------------ Validate Connection ----------------------------- //
    baseValidateConnectionReq = (details: ValidateConnectionDto, transactionId: string): ValidateConnectionReq => ({
        id: transactionId,
        status: ResponseStatus.PENDING,
        taskType: TaskType.VALIDATE_CONNECTION,
        transactionId: transactionId,
        workerId: '',
        operations: details.protocols.map((it): ValidateConnectionOptionReq => ({
            operation: it.protocol == Protocol.NFS ? Operations.VALIDATE_NFS_CONNECTION : Operations.VALIDATE_SMB_CONNECTION,
            request: {
                hostname: details.hostname,
                username: it.username,
                password: it.password
            },
            status: ResponseStatus.PENDING,
        }))
    })

    async validateWorkerConnection(details: ValidateConnectionDto) {
        const transactionId = uuidv4();
        const base = this.baseValidateConnectionReq(details, transactionId);
        details.workers.forEach(async (worker) => {
            details.protocols.forEach(async (protocolInfo) => {
                const requestTrack = this.requestTrackEntity.create({
                    transactionId, status: ResponseStatus.PENDING,
                    taskType: TaskType.VALIDATE_CONNECTION,
                    workerId: worker, createdBy: transactionId,
                    operation: protocolInfo.protocol == Protocol.NFS ? Operations.VALIDATE_NFS_CONNECTION : Operations.VALIDATE_SMB_CONNECTION,
                })
                await this.requestTrackEntity.save(requestTrack)
            })
            this.notifyEventToWorker(worker, SocketEvents.VALIDATE_CONNECTION, { ...base, workerId: worker })
        })
        return { requestId: transactionId }
    }



    // ------------------------------ List Path ----------------------------- //
    baseListPathReqByDetails = (cred: Omit<Credentials, 'workers'>[], transactionId: string, worker: string): ListPathReq => ({
        id: transactionId,
        status: ResponseStatus.PENDING,
        taskType: TaskType.LIST_PATHS,
        transactionId: transactionId,
        workerId: worker,
        operations: cred.map((it): ListPathOptionReq => ({
            operation: it.protocol === Protocol.NFS ? Operations.LIST_NFS_PATHS : Operations.LIST_SMB_PATHS,
            request: {
                hostname: it.details?.hostname,
                password: it.details?.password,
                username: it.details?.username,
            },
            status: ResponseStatus.PENDING,
        }))
    })


    async fetchPathsByCred(details: ListPathsMsg) {
        const transactionId = uuidv4();
        const map = new Map<string, Omit<Credentials, 'workers'>[]>()

        details.credentials.forEach(async cred => {
            cred.workers.forEach(worker => {
                if (map.has(worker))
                    map.set(worker, [...map.get(worker), cred])
                else map.set(worker, [cred])
            })
        })
        await this.fetchPathNotify(map, transactionId, details.configId)
    }


    async fetchPaths(configId: string) {
        const config = await this.fileConfigService.getPathConfig(configId)

        if (!config)
            throw new NotFoundException(`Config with ${configId} configId does not exists.`)

        const transactionId = uuidv4();

        const map = new Map<string, Omit<Credentials, 'workers'>[]>()
        config.fileServers.forEach(async server => {
            server.workers.forEach(async worker => {
                const cred: Omit<Credentials, 'workers'> = {
                    protocol: server.protocol,
                    details: {
                        hostname: server.host,
                        username: server.userName,
                        password: server.password
                    }
                }
                if (map.has(worker.workerId))
                    map.set(worker.workerId, [...map.get(worker.workerId), cred])
                else map.set(worker.workerId, [cred])

            })
        })
        await this.fetchPathNotify(map, transactionId, configId)
        return await this.fileConfigService.updateRefetchingConfig(config)
    }

    async fetchPathNotify(map: Map<string, Omit<Credentials, 'workers'>[]>, transactionId: string, configId: string) {
        map.forEach(async (credentials, worker) => {
            const payload = this.baseListPathReqByDetails(credentials, transactionId, worker)
            const promise = credentials.map(async cred => {
                const requestTrack = this.requestTrackEntity.create({
                    transactionId, status: ResponseStatus.PENDING,
                    taskType: TaskType.LIST_PATHS,
                    workerId: worker, createdBy: transactionId,
                    operation: cred.protocol == Protocol.NFS ? Operations.LIST_NFS_PATHS : Operations.LIST_SMB_PATHS,
                    configId: configId
                })
                await this.requestTrackEntity.save(requestTrack)
            })
            await Promise.all(promise)
            await this.notifyEventToWorker(worker, SocketEvents.LIST_PATH, payload)

        })
    }

    // async createTasks(data) {
    //     const task = {
    //         jobRunId: data.jobRunId,
    //         taskType: TasksType.Scan,
    //         status: TaskStatus.Pending,
    //         operations: [{
    //                 operation: TaskOperation.ScanPath,
    //                 request: {
    //                     pathId: data.pathId,
    //                     folder: data.folder,
    //                 },
    //                 status: TaskStatus.Pending,
    //             },
    //         ],
    //     };
    //     return this.taskService.create(task);
    //}
}
