import { Injectable } from '@nestjs/common';
import { LogGeneratorActivity } from './log-generator/log-generator.activity';

@Injectable()
export class ActivitiesService {
  constructor(private readonly logGeneratorActivity: LogGeneratorActivity) {}

  async fetchAndZipLogs({ traceId, payload }) {
    return this.logGeneratorActivity.fetchAndZipLogs({
      traceId,
      payload,
    });
  }
}
