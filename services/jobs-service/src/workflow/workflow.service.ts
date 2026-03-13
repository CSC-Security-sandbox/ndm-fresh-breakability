import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Client,
  Connection,
  WorkflowExecutionDescription,
  WorkflowHandleWithFirstExecutionRunId,
} from '@temporalio/client';
import { WorkFlows } from 'src/constants/enums';
import {
  SignalWorkFlowPayload,
  StartWorkFlowPayload,
  WorkflowExecutionStatus,
} from './workflow.types';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { defaultDataConverter } from '@temporalio/common';

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
    if (this.client) return this.client;

    try {
      this.connection = await Connection.connect(
        this.configService.get('temporal'),
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
    }
  }

  async getWorkFlowRes(id: string) {
    const client = await this.getClient();
    const handle = client.workflow.getHandle(id);
    const details: WorkflowExecutionDescription = await handle.describe();
    if (
      (details.status.name as WorkflowExecutionStatus) ===
      WorkflowExecutionStatus.COMPLETED
    )
      return {
        status: details.status.name,
        id: details.workflowId,
        pending: [],
        completed: (await handle.result()) as unknown,
      };
    return {
      status: details.status.name,
      id: details.workflowId,
      pending: details?.raw?.pendingChildren,
      completed: [],
    };
  }

  async sendSignal(data: SignalWorkFlowPayload) {
    const client = await this.getClient();

    return await client.workflowService.signalWorkflowExecution({
      namespace: 'default',
      workflowExecution: { workflowId: data.workflowId },
      signalName: data.signalName,
      input: {
        payloads: [
          defaultDataConverter.payloadConverter.toPayload(data.payload),
        ],
      },
    });
  }

  // check and terminate workflow if it is still running
  async terminateWorkflow(workflowId: string) {
    const client = await this.getClient();
    const handle = client.workflow.getHandle(workflowId);
    const details: WorkflowExecutionDescription = await handle.describe();
    if (
      (details.status.name as WorkflowExecutionStatus) ===
      WorkflowExecutionStatus.RUNNING
    ) {
      await handle.terminate();
      return true;
    }
    return false;
  }

  // get workflow status bu workflow if
  async getWorkflowStatus(workflowId: string) {
    const client = await this.getClient();
    const handle = client.workflow.getHandle(workflowId);
    const details: WorkflowExecutionDescription = await handle.describe();
    return details.status.name;
  }
}
