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
    // private counter = 0;
    // private totalObjects = 0;
    // private completedCount = 0;

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
            urls: [urls],
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
    
    async createInventory(data: CreateInventory[]) {
        try {
            const inventoryRecords = this.inventoryRepo.create(data);
             await this.inventoryRepo.insert(inventoryRecords);
        } catch (err) {
            this.logger.error(`Failed to save inventory records: ${err.message}`, err.stack);
            throw new Error('Error while saving inventory records to the database');
        }
    }

    async operate(payload: InventoryPayload) {
        switch(payload.type) {
            case InventoryPayloadType.DATA_INSERT:
                // this.totalObjects += (payload?.data.length || 0)
                // this.logger.debug(`Inserting Message of length:  ${payload?.data.length} | total count:${++this.counter} | totalObjects : ${this.totalObjects} | Completed Count : ${this.completedCount} `)
                await this.createInventory(payload.data);
                break
            case InventoryPayloadType.DISCOVERY_COMPLETED:
                // this.completedCount++;
                this.notifyDiscoveryCompleted(payload.data)
                // this.logger.debug(`------------------ ${JSON.stringify(payload.data)} ----------------`)
                break;
            default: 
                throw new Error('Invalid Type')
        }
    }

    async notifyDiscoveryCompleted(data: DiscoveryCompletedPayload) {
        await this.reportsClient.send(Pattern.DISCOVERY_COMPLETED, data).toPromise()
    }  
}
