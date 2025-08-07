import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Connection, WorkflowExecutionDescription, WorkflowHandleWithFirstExecutionRunId } from '@temporalio/client';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkFlows } from 'src/constants/enums';
import { StartWorkFlowPayload, WorkflowExecutionStatus } from './workflow.types';

@Injectable()
export class WorkflowService implements OnModuleDestroy{
    private logger : LoggerService;
    private client: Client | null = null;
    private connection: Connection | null = null;

    constructor(
        private readonly configService: ConfigService,
        private loggerFactory: LoggerFactory
    ) {
        this.logger = this.loggerFactory.create(WorkflowService.name);
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
            if (this.connection) {
                await this.connection.close();
            }
            throw error;
        }
    }

    async startWorkflow(workflowName: WorkFlows, payload: StartWorkFlowPayload): Promise<WorkflowHandleWithFirstExecutionRunId> {
        try{
            const client = await this.getClient();
            this.logger.debug(`Started workflow: ${workflowName}`);
            const handle: WorkflowHandleWithFirstExecutionRunId = await client.workflow.start(workflowName, payload);
            this.logger.log(
                `Workflow started: ${JSON.stringify(
                    { workflowId: handle.workflowId, firstExecutionRunId: handle.firstExecutionRunId },
                    null,
                    2,
                )}`,
            );
            return handle
        } catch (error) {
            this.logger.error(`Failed to start workflow: ${error}`);
        }
    }

    async getWorkFlowRes(id: string) {
        const client = await this.getClient();
        const handle = client.workflow.getHandle(id);
        const details: WorkflowExecutionDescription = await handle.describe() 
        if(details.status.name ===  WorkflowExecutionStatus.COMPLETED) 
            return { status: details.status.name, id: details.workflowId, pending: [], completed: await handle.result()} 
        return { status: details.status.name, id: details.workflowId, pending: details?.raw?.pendingChildren, completed: []}
    }

    onModuleDestroy() {
        try{
            if(this.client) {
                this.client.connection.close();
                this.logger.log(`Closing client connection with temporal`)
            }
        }catch(error) {
            this.logger.error(`Error while closing temporal connection : ${error}`)
        }
    }

    async getWorkFlowPayload(workflowId: string) {
        const client = await this.getClient();
        const { history } = await client.workflowService.getWorkflowExecutionHistory({
            namespace: 'default',
            execution: { workflowId }
        });
        const startedEvent = history?.events?.find(e => e.workflowExecutionStartedEventAttributes);
        const payloads = startedEvent?.workflowExecutionStartedEventAttributes?.input?.payloads;

        if (!payloads || payloads.length === 0) {
            console.warn(`No payloads found for workflow ${workflowId}`);
            return [];
        }
        return payloads.map(p => {
            const buffer = Buffer.from(p.data as Uint8Array);
            const jsonString = buffer.toString('utf8');
            return JSON.parse(jsonString);
        });
    }
}
