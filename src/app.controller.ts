import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import {
  Ctx,
  MessagePattern,
  Payload,
  RmqContext,
} from '@nestjs/microservices';
import { InventoryService } from './services/inventory.service';

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

  @MessagePattern('hello')
  public async handleMessage(@Payload() data: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    console.log('Received message:', data);

    // persisting data into mnongoDB    
    await this.inventoryService.createInventory(JSON.parse(data).message);
    console.log("created invetory");
    
    // Acknowledge the message
    channel.ack(originalMsg);
  }
}
