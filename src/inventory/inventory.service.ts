import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryEntity } from '../entities/inventory.entity';
import { CreateInventory, DiscoveryCompletedPayload, InventoryPayload, InventoryPayloadType } from './inventory.type';
import { ConfigService } from '@nestjs/config';
import { ClientProxy, ClientProxyFactory, Transport } from '@nestjs/microservices';
import { OperationStatus, OperationType, Pattern } from 'src/enum/queues.enum';
import { TaskEntity } from 'src/entities/task.entity';
import { OperationsEntity } from 'src/entities/operation.entity';
import { randomUUID } from 'crypto';

@Injectable()
export class InventoryService {

    // debugs
    private counter = 0;
    private totalObjects = 0;
    private completedCount = 0;

    private readonly logger = new Logger(InventoryService.name);
    private reportsClient: ClientProxy;

    constructor(
        @InjectRepository(InventoryEntity)
        private readonly inventoryRepo: Repository<InventoryEntity>,
        private readonly configService: ConfigService,
        @InjectRepository(TaskEntity)
        private readonly taskRepo: Repository<TaskEntity>,
        @InjectRepository(OperationsEntity)
        private readonly operationRepo: Repository<OperationsEntity>,

    ) { 

        const urls: any = this.configService.get<string[]>('app.rabbitmq.urls') || '';
        this.reportsClient = ClientProxyFactory.create({
          transport: Transport.RMQ,
          options: {
            urls: urls,
            queue: this.configService.get<string>('app.rabbitmq.reportsQueue') || '',
            queueOptions: {
              durable: true,
              arguments: {
                'x-queue-type': 'quorum',
            },
          },
          },
        });
    }
    
    async createInventory(data: CreateInventory[],jobRunId: string) {
        try {
            const mappedData = this.mapSourceToTarget(data[0],jobRunId);
            const inventoryRecords = this.inventoryRepo.create(mappedData);
             await this.inventoryRepo.insert(inventoryRecords);
        } catch (err) {
            this.logger.error(`Failed to save inventory records: ${err.message}`, err.stack);
            throw new Error('Error while saving inventory records to the database');
        }
    }
     mapSourceToTarget(file: any,jobRunId:string): any {
        return {
          path: file.path,
          isDirectory: file.isDirectory,
          sourceChecksum: "", 
          targetChecksum: "", 
          parentPath: file.parentPath,
          depth: file.depth,
          fileName: file.fileName,
          uid: file.uid.toString(),
          gid: file.gid.toString(),
          fileSize: BigInt(file.size),
          extension: file.extension,
          fileType: file.fileType as any,
          modifiedTime: file.mtime.toISOString(),
          accessTime: file.atime.toISOString(),
          permission: file.permission,
          jobRunId: jobRunId, 
          birthTime: file.ctime.toISOString(),
        };
      }

    async operate(payload: InventoryPayload) {
        switch(payload.type) {
            case InventoryPayloadType.DISCOVERY_COMPLETED:
                this.completedCount++;
                this.notifyDiscoveryCompleted(payload.data)
                this.logger.debug(`------------------ ${JSON.stringify(payload.data)} ----------------`)
                break;
            default: 
                throw new Error('Invalid Type')
        }
    }

    async notifyDiscoveryCompleted(data: DiscoveryCompletedPayload) {
        await this.reportsClient.send(Pattern.DISCOVERY_COMPLETED, data).toPromise()
    }  
  async saveTasks(data: any) {
    try {
    const {id,jobRunId,taskType,status,sPath,tPath,excludeFilePatterns,commands} = data;
     let  workerId =  randomUUID();
    const task = this.taskRepo.create({
      id: id,
      jobRunId: jobRunId,
      status:status,
      taskType:taskType,
      workerId: workerId
    });
   const taskEntity=  await this.taskRepo.insert(task);
   console.log ('taskEntity',taskEntity);
    const operation = this.operationRepo.create({
      taskId: id,
     jobRunId: jobRunId,
     sPathId: workerId,
     tPathId:  tPath ?? null,
     status : OperationStatus.COMPLETED,
     operationType: OperationType.SCAN,
     request:commands,
     fPath: commands[0]?.fPath
    });
    await this.operationRepo.insert(operation);
  }catch(err){  
    this.logger.error(`Failed to save task records: ${err.message}`, err.stack);
    throw new Error('Error while saving task records to the database');
  }
}
}
