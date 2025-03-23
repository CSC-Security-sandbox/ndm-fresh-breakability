import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Connection } from '@temporalio/client';


@Injectable()
export class WorkflowService {

    private client: Client | null = null;
    private connection: Connection | null = null;

    constructor(
        private readonly configService: ConfigService,
    ) { }

    private async getClient(): Promise<Client> {
        if (this.client)
            return this.client;
        try {
            this.connection = await Connection.connect(this.configService.get<any>('temporal'));
            this.client = new Client({ connection: this.connection });
            return this.client;

        } catch (error) {
            console.log(`Error on getClient : ${error} ${this.configService.get<any>('temporal.address')}`)
            throw error// return this.getClient()
        }
    }

    async signalWorkflow(request: any): Promise<any> {
        try {
            const client = await this.getClient();
            if (!client) {
                throw new Error('Client not found');
            }
            return await client.workflowService.signalWorkflowExecution(request);
        } catch (error) {
            throw error;
        }
    }

}
