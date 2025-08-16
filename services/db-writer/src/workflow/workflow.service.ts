import { Injectable, Inject, OnModuleDestroy, Optional, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Connection } from '@temporalio/client';
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';
import { WorkflowError, ConfigurationError } from '../errors/custom-errors';


@Injectable()
export class WorkflowService implements OnModuleDestroy {

    private client: Client | null = null;
    private connection: Connection | null = null;
    private readonly logger: LoggerService;

    constructor(
        private readonly configService: ConfigService,
        @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory,
    ) { 
        if (loggerFactory) {
            this.logger = loggerFactory.create(WorkflowService.name);
        } else {
            // Fallback to basic NestJS Logger for worker threads
            this.logger = new Logger(WorkflowService.name) as any;
        }
    }

    private async getClient(): Promise<Client> {
        if (this.client)
            return this.client;
        try {
            this.connection = await Connection.connect({
                address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
            });
            this.client = new Client({ connection: this.connection });
            return this.client;

        } catch (error) {
            this.logger.error(`Error connecting to Temporal server: ${error.message}`, error.stack);
            this.logger.error(`Temporal config: ${JSON.stringify(process.env.TEMPORAL_ADDRESS || 'localhost:7233')}`);
            throw new WorkflowError(`Failed to initialize Temporal client: ${error.message}`, error);
        }
    }

    async signalWorkflow(request: any): Promise<any> {
        try {
            const client = await this.getClient();
            if (!client) {
                throw new ConfigurationError('Temporal client not available');
            }
            this.logger.log(`Signaling workflow: ${request.workflowExecution?.workflowId}`);
            return await client.workflowService.signalWorkflowExecution(request);
        } catch (error) {
            this.logger.error(`Failed to signal workflow: ${error.message}`, error.stack);
            throw new WorkflowError(`Workflow signal failed: ${error.message}`, error);
        }
    }

    /**
     * Cleanup method to properly close connections when module is destroyed
     */
    async onModuleDestroy(): Promise<void> {
        try {
            if (this.connection) {
                await this.connection.close();
                this.logger.log('Temporal connection closed');
            }
        } catch (error) {
            this.logger.error(`Error closing Temporal connection: ${error.message}`, error?.stack || error);
        } finally {
            this.connection = null;
            this.client = null;
        }
    }

}
