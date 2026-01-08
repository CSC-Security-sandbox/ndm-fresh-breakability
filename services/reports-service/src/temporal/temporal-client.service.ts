import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Connection, WorkflowExecutionDescription } from '@temporalio/client';

export enum WorkflowStatus {
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  TERMINATED = 'TERMINATED',
  TIMED_OUT = 'TIMED_OUT',
}

export interface StartWorkflowOptions {
  workflowName: string;
  workflowId: string;
  taskQueue?: string;
  args: any[];
  workflowExecutionTimeout?: string;
  workflowRunTimeout?: string;
}

@Injectable()
export class TemporalClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TemporalClientService.name);
  private client: Client | null = null;
  private connection: Connection | null = null;
  private readonly defaultTaskQueue = 'reports-TaskQueue';

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect(): Promise<void> {
    try {
      const temporalAddress = this.configService.get<string>('temporal.address');
      this.connection = await Connection.connect({ address: temporalAddress });
      this.client = new Client({ connection: this.connection });
      this.logger.log(`Connected to Temporal at ${temporalAddress}`);
    } catch (error) {
      this.logger.error(`Failed to connect to Temporal: ${error.message}`);
      throw error;
    }
  }

  private async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
      this.client = null;
      this.logger.log('Disconnected from Temporal');
    }
  }

  private async getClient(): Promise<Client> {
    if (!this.client) {
      await this.connect();
    }
    return this.client!;
  }

  async startWorkflow(options: StartWorkflowOptions): Promise<string> {
    const client = await this.getClient();

    this.logger.log(`Starting workflow: ${options.workflowName}, workflowId: ${options.workflowId}`);

    const workflowOptions: {
      taskQueue: string;
      workflowId: string;
      args: any[];
      [key: string]: any;
    } = {
      taskQueue: options.taskQueue || this.defaultTaskQueue,
      workflowId: options.workflowId,
      args: options.args,
    };

    if (options.workflowExecutionTimeout) {
      workflowOptions.workflowExecutionTimeout = options.workflowExecutionTimeout;
    }

    if (options.workflowRunTimeout) {
      workflowOptions.workflowRunTimeout = options.workflowRunTimeout;
    }

    const handle = await (client.workflow.start as any)(
      options.workflowName,
      workflowOptions,
    );

    this.logger.log(`Workflow started: ${options.workflowId}, runId: ${handle.firstExecutionRunId}`);

    return options.workflowId;
  }
  async getWorkflowStatus(workflowId: string): Promise<{
    status: WorkflowStatus;
    result?: any;
    error?: string;
  }> {
    const client = await this.getClient();
    
    try {
      const handle = client.workflow.getHandle(workflowId);
      const description: WorkflowExecutionDescription = await handle.describe();
      
      const status = description.status.name as WorkflowStatus;
      
      if (status === WorkflowStatus.COMPLETED) {
        const result = await handle.result();
        return { status, result };
      }
      
      if (status === WorkflowStatus.FAILED) {
        return { status, error: 'Workflow failed' };
      }
      
      return { status };
    } catch (error) {
      this.logger.error(`Failed to get workflow status for ${workflowId}: ${error.message}`);
      throw error;
    }
  }

  async waitForWorkflowResult(workflowId: string): Promise<any> {
    const client = await this.getClient();
    const handle = client.workflow.getHandle(workflowId);
    return await handle.result();
  }
}