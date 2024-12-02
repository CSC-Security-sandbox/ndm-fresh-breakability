import { Controller, Get, Inject, Logger } from '@nestjs/common';
import { AppService } from './app.service';
import {
  Ctx,
  MessagePattern,
  Payload,
  RmqContext,
} from '@nestjs/microservices';
import { InventoryService } from './services/inventory.service';
import { MessagesName } from './enum/message.enum';
import { RabbitMQConfigService } from './config/rabbitmq.config';
// import { TaskService } from './services/task.service';

@Controller()
export class AppController {
  constructor(
    @Inject(RabbitMQConfigService)
    private readonly config: RabbitMQConfigService,
    private readonly appService: AppService,
    private readonly inventoryService: InventoryService,
    // private readonly taskService: TaskService
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // @MessagePattern(MessagesName.CREATE_INVENTORY)
  // public async handleInventoryMessage(@Payload() data: any, @Ctx() context: RmqContext) {
  //   const channel = context.getChannelRef();
  //   const originalMsg = context.getMessage();
  //   Logger.log('inventory creation started');
  //   await this.inventoryService.createInventory(JSON.parse(data));
  //   Logger.log('inventory created successfully');

  //   // Acknowledge the message
  //   channel.ack(originalMsg);
  // }

  // @MessagePattern('myqueue-task-list')
  // public async handleTaskMessage(@Payload() data: any, @Ctx() context: RmqContext) {
  //   const channel = context.getChannelRef();
  //   const originalMsg = context.getMessage();
  //   Logger.log('task creation started');
  //   Logger.log(`DATA - ${JSON.parse(data)}`);
  //   // await this.taskService.createTaskList(JSON.parse(data));
  //   Logger.log('task created successfully');

  //   // Acknowledge the message
  //   channel.ack(originalMsg);
  // }



  @MessagePattern(MessagesName.CREATE_TASK_LIST) // Listening to task list queue
  async handleTaskListMessage(
    @Payload() data: any,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    try {
      console.log(`Received task message: ${JSON.stringify(data)}`);
      // Process the task message
      channel.ack(originalMsg);
    } catch (err) {
      console.error(`Error processing task message: ${err.message}`);
      channel.nack(originalMsg);
    }
  }

  @MessagePattern('CREATE_INVENTORY') // Listening to inventory queue
  async handleInventoryMessage(
    @Payload() data: any,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    try {
      console.log(`Received inventory message: ${JSON.stringify(data)}`);
      // Process the inventory message
      channel.ack(originalMsg);
    } catch (err) {
      console.error(`Error processing inventory message: ${err.message}`);
      channel.nack(originalMsg);
    }
  }




}

