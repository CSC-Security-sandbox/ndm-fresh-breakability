import { Body, Controller, Delete, Get, Param, Post, Put, Logger } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, RmqContext } from '@nestjs/microservices';
import { InventoryService } from './inventory.service';
import { Queues } from '../enum/queues.enum';
import { CreateInventoryDto } from '../dto/create-inventory.dto';
import { UpdateInventoryDto } from '../dto/update-inventory.dto';

@Controller('inventory')
export class InventoryController {
    private readonly logger = new Logger(InventoryController.name);

    constructor(private readonly inventoryService: InventoryService) { }

    @Post()
    async createInventory(@Body() data: CreateInventoryDto) {
        return await this.inventoryService.createInventory(data);
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

    @MessagePattern(Queues.INVENTORY)
    async handleInventoryMessage(
        @Payload() data: CreateInventoryDto,
        @Ctx() context: RmqContext,
    ) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        try {
            this.logger.log(`Received inventory message: ${JSON.stringify(data)}`);
            this.logger.log('inventory creation started');
            await this.inventoryService.createInventory(data);
            this.logger.log('inventory created successfully');
            channel.ack(originalMsg);
        } catch (err) {
            this.logger.error(`Error processing inventory message: ${err.message}`);
            channel.nack(originalMsg);
        }
    }
}
