import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Logger } from '@nestjs/common';

@Injectable()
export class NotifyConfigActivity {
  private readonly logger = new Logger(NotifyConfigActivity.name);
  private configBaseUrl: string ;

  constructor(private readonly configService: ConfigService) {
    const configUrl = this.configService.get<string>('support-bundle.api.configUrl');
    if (!configUrl) {
      throw new Error('Config URL for support-bundle.api.configUrl is not defined');
    }
    this.configBaseUrl = configUrl;
  }

  async notifyWorkflowCompletion({ traceId, status, errorMessage }) {
    try {
      await axios.post(
        `${this.configBaseUrl}/support-bundle/workflow-status-update`,
        {
          traceId,
          status,
          errorMessage
        },
        {
          headers: {
            trackId: traceId
          }
        }
      );
      this.logger.log(`[${traceId}] Notification sent to Config Service for workflow completion`);
    } catch (error) {
      this.logger.error(`[${traceId}] Failed to notify Config Service: ${error.message}`);
      throw error;
    }
  }
}
