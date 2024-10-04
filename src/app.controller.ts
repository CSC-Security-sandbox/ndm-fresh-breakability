import { Controller, Get, Logger } from '@nestjs/common';
import { AppService } from './app.service';
import {
  Ctx,
  MessagePattern,
  Payload,
  RmqContext,
} from '@nestjs/microservices';
import { InventoryService } from './services/inventory.service';
import { MessagesName } from './enum/message.enum';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly inventoryService: InventoryService
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @MessagePattern(MessagesName.CREATE_INVENTORY)
  public async handleMessage(@Payload() data: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    Logger.log('inventory creation started');
    await this.inventoryService.createInventory(JSON.parse(data));
    Logger.log('inventory created successfully');

    // Acknowledge the message
    channel.ack(originalMsg);
  }
}
