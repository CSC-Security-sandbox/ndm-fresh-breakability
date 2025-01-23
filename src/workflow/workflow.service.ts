import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Connection, WorkflowHandleWithFirstExecutionRunId } from '@temporalio/client';
import { WorkFlows } from 'src/constants/enums';
import { StartWorkFlowPayload } from './workflow.types';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class WorkflowService {
    private logger : LoggerService
    private client: Client | null = null;
    private connection: Connection | null = null;

    constructor(
        private readonly configService: ConfigService,
        private loggerFactory: LoggerFactory
        ) {
         this.logger = this.loggerFactory.create(WorkflowService.name)
    }

    private async getClient(): Promise<Client> {
        if (this.client) 
        return this.client;

        try {
            this.connection = await Connection.connect(this.configService.get<any>('temporal'));
            this.client = new Client({ connection: this.connection });
            return this.client;
        } catch (error) {
            this.logger.error(`Failed to connect to Temporal: ${error}`);
            throw error;
        }
    }

    async startWorkflow(workflowName: WorkFlows, payload: StartWorkFlowPayload): Promise<WorkflowHandleWithFirstExecutionRunId> {
        try{
            const client = await this.getClient();
            this.logger.log(`Starting workflow: ${workflowName}`);
            const handle: WorkflowHandleWithFirstExecutionRunId = await client.workflow.start(workflowName, payload);
            this.logger.log(
                `Workflow started: ${JSON.stringify(
                    { workflowId: handle.workflowId, firstExecutionRunId: handle.firstExecutionRunId },
                    null,
                    2,
                )}`,
            );
            return handle;
        } catch (error) {
            this.logger.error(`Failed to start workflow: ${error}`);
        }
    }
}
