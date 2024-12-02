import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Ctx, RmqContext } from '@nestjs/microservices';
import { MessagesName } from 'src/enum/message.enum';

@Controller()
export class RabbitmqController {
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
