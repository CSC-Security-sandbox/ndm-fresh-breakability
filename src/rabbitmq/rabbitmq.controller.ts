import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Ctx, RmqContext } from '@nestjs/microservices';
import { MessagesName } from 'src/constants/enums';
import { RabbitmqService } from './rabbitmq.service';

@Controller()
export class RabbitmqController {

  constructor(
    private readonly rabbitmqService: RabbitmqService,
  ) {}

  @MessagePattern(MessagesName.CREATE_TASK_LIST)
  async handleTaskListMessage(
    @Payload() data: any,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    try {
      Logger.log(`Received task message: ${JSON.stringify(data)}`);
      // Process the task message
      await this.rabbitmqService.handleTaskListMessage(data);
      channel.ack(originalMsg);
    } catch (err) {
      Logger.error(`Error processing task message: ${err.message}`);
      channel.nack(originalMsg);
    }
  }
}
