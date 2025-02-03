import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryEntity } from '../entities/inventory.entity';
import { CreateInventory, DiscoveryCompletedPayload, InventoryPayload, InventoryPayloadType } from './inventory.type';
import { ConfigService } from '@nestjs/config';
import { ClientProxy, ClientProxyFactory, Transport } from '@nestjs/microservices';
import { Pattern } from 'src/enum/queues.enum';

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
        private readonly configService: ConfigService
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
}
