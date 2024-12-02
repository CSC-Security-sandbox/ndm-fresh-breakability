import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class RabbitmqService {
    constructor() { }

    async handleTaskListMessage(data: any) {
        try {
            Logger.log(`Received task list message: ${JSON.stringify(data)}`);
            // Process the task message add task data into the task table
            Logger.log(`Processing task list message`);
        } catch (error) {
            Logger.error(`Error processing task list message: ${error}`);
        }
    }
}
