import { Injectable, Inject, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Client,
  Connection,
  WorkflowExecutionDescription,
  WorkflowHandleWithFirstExecutionRunId,
} from '@temporalio/client';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkFlows, StartWorkFlowPayload, WorkflowExecutionStatus } from './workflow.types';


@Injectable()
export class WorkflowService {
  private logger: LoggerService;
  private client: Client | null = null;
  private connection: Connection | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Inject(LoggerFactory) private loggerFactory: LoggerFactory,
  ) {
    this.logger = this.loggerFactory.create(WorkflowService.name);
  }

  private async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    try {
      this.connection = await Connection.connect(
        this.configService.get<any>('temporal'),
      );
      this.client = new Client({ connection: this.connection });
      return this.client;
    } catch (error) {
      this.logger.error(`Failed to connect to Temporal: ${error}`);
      throw error;
    }
  }

  async startWorkflow(
    workflowName: WorkFlows,
    payload: StartWorkFlowPayload,
  ): Promise<WorkflowHandleWithFirstExecutionRunId> {
    try {
      const client = await this.getClient();
      this.logger.log(`Starting workflow: ${workflowName}`);
      const handle: WorkflowHandleWithFirstExecutionRunId =
        await client.workflow.start(workflowName, payload);
      this.logger.log(
        `Workflow started: ${JSON.stringify(
          {
            workflowId: handle.workflowId,
            firstExecutionRunId: handle.firstExecutionRunId,
          },
          null,
          2,
        )}`,
      );
      return handle;
    } catch (error) {
      this.logger.error(`Failed to start workflow: ${error}`);
      throw error;
    }
  }

  async getWorkflowStatus(workflowId: string): Promise<{
    status: string;
    id: string;
    pending: unknown[];
    completed: unknown;
  }> {
    try {
      const client = await this.getClient();
      const handle = client.workflow.getHandle(workflowId);
      const details: WorkflowExecutionDescription = await handle.describe();
      if (details.status.name === WorkflowExecutionStatus.COMPLETED) {
        return {
          status: details.status.name,
          id: details.workflowId,
          pending: [],
          completed: await handle.result(),
        };
      }
      return {
        status: details.status.name,
        id: details.workflowId,
        pending: details?.raw?.pendingChildren || [],
        completed: [],
      };
    } catch (error) {
      this.logger.error(`Failed to get workflow status for ${workflowId}`, error);
      throw new InternalServerErrorException(`Failed to get workflow status for ${workflowId}`);
    }
  }

  async terminateWorkflow(workflowId: string): Promise<boolean> {
    try {
      const client = await this.getClient();
      const handle = client.workflow.getHandle(workflowId);
      const details: WorkflowExecutionDescription = await handle.describe();
      if (details.status.name === WorkflowExecutionStatus.RUNNING) {
        await handle.terminate();
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`Failed to terminate workflow ${workflowId}`, error);
      throw new InternalServerErrorException(`Failed to terminate workflow ${workflowId}`);
    }
  }
}
