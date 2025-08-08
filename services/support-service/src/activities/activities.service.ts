import { Injectable } from '@nestjs/common';
import { LogGeneratorActivity } from './log-generator/log-generator.activity';
import { NotifyConfigActivity } from './notify-config/notify-config.activity';
import { ErrorCsvGenerationActivity } from './error-csv-generation/error-csv-generation.activity';
import { ConfigurationDataCsvGenerationActivity } from './config-data-csv-generation/config-data-csv-generation.activity';
import { PerformanceMetricsCsvGenerationActivity } from './performance-metrics-csv-generation/performance-metrics-csv-generation.activity';

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly logGeneratorActivity: LogGeneratorActivity,
    private readonly notifyConfigActivity: NotifyConfigActivity,
    private readonly errorCsvGenerationActivity: ErrorCsvGenerationActivity,
    private readonly configurationDataCsvGenerationActivity: ConfigurationDataCsvGenerationActivity,
    private readonly performanceMetricsCsvGenerationActivity: PerformanceMetricsCsvGenerationActivity,
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

  async generateConfigurationDataCsv({ traceId, payload }) {
    return this.configurationDataCsvGenerationActivity.generateConfigurationDataCsv(
      {
        traceId,
        payload,
      },
    );
  }

  async generatePerformanceMetricsCsv({ traceId, payload }) {
    return this.performanceMetricsCsvGenerationActivity.generatePerformanceMetricsCsv(
      {
        traceId,
        payload,
      },
    );
  }

  async generateConfigurationJobCsv({ traceId, payload }) {
    return this.configurationDataCsvGenerationActivity.generateConfigurationJobCsv(
      {
        traceId,
        payload,
      },
    );
  }

  async notifyWorkflowCompletion({ traceId, status, errorMessage }) {
    return this.notifyConfigActivity.notifyWorkflowCompletion({
      traceId,
      status,
      errorMessage,
    });
  }
}
