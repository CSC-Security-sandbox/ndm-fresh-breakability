import { Controller, Logger } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, RmqContext } from '@nestjs/microservices';
import { Pattern } from '../enum/queues.enum';
import { InventoryService } from './inventory.service';
import { InventoryPayload, InventoryPayloadType } from './inventory.type';

@Controller('inventory')
export class InventoryController {
  
    private readonly logger = new Logger(InventoryController.name);

    constructor(private readonly inventoryService: InventoryService) { }
   
    @MessagePattern(Pattern.INVENTORY)
    async handleInventoryMessage(
        @Payload() payload: InventoryPayload,
        @Ctx() context: RmqContext,
    ) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        try {
            await this.inventoryService.operate(payload);
            channel.ack(originalMsg);
        } catch (err) {
            this.logger.error(`Error processing inventory message: ${err.message}`);
            channel.nack(originalMsg);
        }
    }
}
