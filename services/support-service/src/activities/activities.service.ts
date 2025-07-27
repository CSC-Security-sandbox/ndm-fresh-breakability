import { Injectable } from '@nestjs/common';
import { LogGeneratorActivity } from './log-generator/log-generator.activity';
import { NotifyConfigActivity } from './notify-config/notify-config.activity';

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly logGeneratorActivity: LogGeneratorActivity,
    private readonly notifyConfigActivity: NotifyConfigActivity,
  ) {}

  async fetchAndZipLogs({ traceId, payload }) {
    return this.logGeneratorActivity.fetchAndZipLogs({ traceId, payload });
  }

  async notifyWorkflowCompletion({ traceId, status }) {
    return this.notifyConfigActivity.notifyWorkflowCompletion({
      traceId,
      status,
    });
  }
}
