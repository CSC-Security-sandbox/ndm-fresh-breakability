import { Injectable } from '@nestjs/common';
import { LogGeneratorActivity } from './log-generator/log-generator.activity';
import { NotifyConfigActivity } from './notify-config/notify-config.activity';
import { ErrorCsvGenerationActivity } from './error-csv-generation/error-csv-generation.activity';
import { ProjectJobConfigMappingActivity } from './error-csv-generation/project-jobconfig-mapping.activity';

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly logGeneratorActivity: LogGeneratorActivity,
    private readonly notifyConfigActivity: NotifyConfigActivity,
    private readonly projectJobConfigMappingActivity: ProjectJobConfigMappingActivity,
    private readonly errorCsvGenerationActivity: ErrorCsvGenerationActivity,
  ) { }

  async fetchAndZipLogs({ traceId, payload }) {
    return this.logGeneratorActivity.fetchAndZipLogs({ traceId, payload });
  }

  async getJobConfigIdsByProjectIds({ traceId, payload }) {
    return this.projectJobConfigMappingActivity.getJobConfigIdsByProjectIds({ traceId, payload });
  }

  async generateErrorCsv({ traceId, payload, projectIds }) {
    return this.errorCsvGenerationActivity.generateErrorCsv({ traceId, payload, projectIds });
  }

  async notifyWorkflowCompletion({ traceId, status, errorMessage }) {
    return this.notifyConfigActivity.notifyWorkflowCompletion({
      traceId,
      status,
      errorMessage
    });
  }
}
