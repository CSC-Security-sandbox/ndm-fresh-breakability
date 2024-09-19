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

  @MessagePattern('createInventory')
  public async handleMessage(@Payload() data: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    console.log('Received message:', data);

    // persisting data into mnongoDB    
    console.log('inventory creation started');
    await this.inventoryService.createInventory(JSON.parse(data).message);
    console.log('inventory created successfully');

    // const invData = await this.inventoryService.getInventoryById("66ead3d09c19e154d7a849b5");
    // console.log(`invData ${invData}`);
  
    // Acknowledge the message
    channel.ack(originalMsg);
  }
}
