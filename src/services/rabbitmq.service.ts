// import { Injectable } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { TaskEntity } from 'src/entities/task.entity';
// import { Repository } from 'typeorm';

// @Injectable()
// export class TaskService {

//     constructor(
//         @InjectRepository(TaskEntity)
//         private taskRepo: Repository<TaskEntity>
//     ) {}


//     async createTaskList(data: any) {
//         try{
//           const taskRecord = this.taskRepo.create({
//             jobRunId: data?.mountPath,
//             status: data?.fileServer,
//             taskType: data?.fileName,
//             operations: data.parentPath,
//           });
//           return this.taskRepo.save(taskRecord);
//         } catch(err) {
//           console.log(`Error while saving data in the db - ${err}`);
//         }
//     }
// }


import { Injectable, Logger } from '@nestjs/common';
import { Ctx, Payload, RmqContext, Transport } from '@nestjs/microservices';
import { RabbitMQConfigService } from '../config/rabbitmq.config';

@Injectable()
export class RabbitMQConsumerService {
  constructor(private readonly configService: RabbitMQConfigService) {}

  // Consumer for CREATE_TASK_LIST messages
  async handleTaskListMessage(@Payload() data: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    try {
      Logger.log(`Received task list message: ${JSON.stringify(data)}`);
      // Process the task message
      // Example: Call a service method to process the task data
      Logger.log(`Processing task list message: ${JSON.stringify(data)}`);

      // Acknowledge message
      channel.ack(originalMsg);
    } catch (error) {
      Logger.error(`Error processing task list message: ${error}`);
      // Optionally reject the message
      channel.nack(originalMsg, false, false);
    }
  }

  // Consumer for CREATE_INVENTORY messages
  async handleInventoryMessage(@Payload() data: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    try {
      Logger.log(`Received inventory message: ${JSON.stringify(data)}`);
      // Process the inventory message
      // Example: Call a service method to process the inventory data
      Logger.log(`Processing inventory message: ${JSON.stringify(data)}`);

      // Acknowledge message
      channel.ack(originalMsg);
    } catch (error) {
      Logger.error(`Error processing inventory message: ${error}`);
      // Optionally reject the message
      channel.nack(originalMsg, false, false);
    }
  }
}
