import { Injectable } from '@nestjs/common';
import { LogGeneratorService } from './log-generator/log-generator.service';

@Injectable()
export class ActivitiesService {
  constructor(private readonly logGeneratorService: LogGeneratorService) {}

  async fetchAndZipLogsUsingFind({ traceId, payload }) {
    return this.logGeneratorService.fetchAndZipLogsUsingFind({
      traceId,
      payload,
    });
  }
}
