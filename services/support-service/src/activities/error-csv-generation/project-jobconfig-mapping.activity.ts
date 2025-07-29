

import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ProjectJobConfigMappingActivity {
  constructor(
  ) {}

  async getJobConfigIdsByProjectIds({ traceId, payload }): Promise<
    { projectId: string; jobConfigIds: string[] }[]
  > {
    return payload.projectWorkerMap
      .map((map) => map.projectId)
      .filter(Boolean);
  }
}
