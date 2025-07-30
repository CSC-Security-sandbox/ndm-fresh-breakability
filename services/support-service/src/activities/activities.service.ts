import { Injectable } from '@nestjs/common';
import { LogGeneratorActivity } from './log-generator/log-generator.activity';
import { NotifyConfigActivity } from './notify-config/notify-config.activity';
import { ErrorCsvGenerationActivity } from './error-csv-generation/error-csv-generation.activity';

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly logGeneratorActivity: LogGeneratorActivity,
    private readonly notifyConfigActivity: NotifyConfigActivity,
    private readonly errorCsvGenerationActivity: ErrorCsvGenerationActivity,
  ) {}

  async fetchAndZipLogs({ traceId, payload }) {
    return this.logGeneratorActivity.fetchAndZipLogs({ traceId, payload });
  }

  async generateErrorCsv({ traceId, payload }) {
    return this.errorCsvGenerationActivity.generateErrorCsv({
      traceId,
      payload,
    });
  }

  async notifyWorkflowCompletion({ traceId, status, errorMessage }) {
    return this.notifyConfigActivity.notifyWorkflowCompletion({
      traceId,
      status,
      errorMessage,
    });
  }
}
