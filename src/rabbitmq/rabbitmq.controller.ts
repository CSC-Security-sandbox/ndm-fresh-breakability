import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Ctx, RmqContext } from '@nestjs/microservices';
import { QueueNames } from 'src/constants/enums';
import { RabbitmqService } from './rabbitmq.service';

@Controller()
export class RabbitmqController {
  private readonly logger = new Logger(RabbitmqController.name);

  constructor(
    private readonly rabbitmqService: RabbitmqService,
  ) { }

  @MessagePattern(QueueNames.TASK_LIST)
  async handleTaskListMessage(
    @Payload() data: any,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    try {
      this.logger.log(`Received task message: ${JSON.stringify(data)}`);
      await this.rabbitmqService.handleTaskListMessage(data);
      channel.ack(originalMsg);
    } catch (err) {
      this.logger.error(`Error processing task message: ${err.message}`);
      channel.nack(originalMsg);
    }
  }
}
