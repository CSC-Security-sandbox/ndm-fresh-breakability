import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class NotifyConfigActivity {
  async notifyWorkflowCompletion({ traceId, status }) {
    try {
      await axios.post('http://localhost:3009/api/v1/support-bundle/workflow-status-update', {
        traceId,
        status,
      });
      console.log(`Notification sent to Config Service for ${traceId}`);
    } catch (error) {
      console.error(`Failed to notify Config Service: ${error.message}`);
      throw error;
    }
  }
}
