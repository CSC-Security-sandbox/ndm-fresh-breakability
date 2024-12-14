import { Body, Controller, Delete, Get, Logger, Param, Post, Put } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, RmqContext } from '@nestjs/microservices';
import { CreateInventoryDto } from '../dto/create-inventory.dto';
import { UpdateInventoryDto } from '../dto/update-inventory.dto';
import { Pattern } from '../enum/queues.enum';
import { InventoryService } from './inventory.service';
import { InventoryPayload, InventoryPayloadType } from './inventory.type';

@Controller('inventory')
export class InventoryController {
    private counter = 0;
    private totalObjects = 0;
    private completedCount = 0;
    private readonly logger = new Logger(InventoryController.name);

    constructor(private readonly inventoryService: InventoryService) { }

    @Post()
    async createInventory(@Body() data: CreateInventoryDto) {
        return await this.inventoryService.createInventory([data]);
    }

    @Get(':id')
    async getInventoryById(@Param('id') id: string) {
        return await this.inventoryService.getInventoryById(id);
    }

    @Put(':id')
    async updateInventory(
        @Param('id') id: string,
        @Body() data: UpdateInventoryDto,
    ) {
        return await this.inventoryService.updateInventory(id, data);
    }

    @Delete(':id')
    async deleteInventory(@Param('id') id: string) {
        return await this.inventoryService.deleteInventory(id);
    }

    @Get()
    async getAllInventories() {
        return await this.inventoryService.getAllInventories();
    }

    @MessagePattern(Pattern.INVENTORY)
    async handleInventoryMessage(
        @Payload() payload: InventoryPayload,
        @Ctx() context: RmqContext,
    ) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        try {
            // this.logger.error(payload)
            if(payload.type == InventoryPayloadType.DATA_INSERT) {
                await this.inventoryService.createInventory(payload.data);
                this.totalObjects += (payload?.data.length || 0)
                this.logger.debug(`Sending Message of length:  ${payload?.data.length} | total count:${++this.counter} | totalObjects : ${this.totalObjects} | Completed Count : ${this.completedCount} `)
            }else  {
                this.logger.error(`------------------ DISCOVERY_COMPLETED ---------------- \n\n\n\m ------------------ DISCOVERY_COMPLETED ---------------- \n\n\n\m ------------------ DISCOVERY_COMPLETED ---------------- `)
                this.completedCount++;
                this.logger.error(`------------------ ${JSON.stringify(payload.data)} ----------------`)
            }
            channel.ack(originalMsg);
        } catch (err) {
            // this.logger.error(payload)
            this.logger.error(`Error processing inventory message: ${err.message}`);
            // channel.ack(originalMsg);
            channel.nack(originalMsg);
        }
    }
}
