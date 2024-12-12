import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class RabbitmqService {
    private readonly logger = new Logger(RabbitmqService.name);

    constructor() { }

    async handleTaskListMessage(data: any) {
        try {
            this.logger.log(`Received task list message: ${JSON.stringify(data)}`);
            // Process the task message add task data into the task table
            this.logger.log(`Processing task list message`);
        } catch (error) {
            this.logger.error(`Error processing task list message: ${error}`);
        }
    }
}
