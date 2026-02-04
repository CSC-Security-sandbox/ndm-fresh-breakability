import { Injectable, Inject } from '@nestjs/common';

@Injectable()
export class TemporalWorkerService {
  constructor(@Inject('TEMPORAL_WORKER') private worker) {}

  async close() {
    await this.worker.close();
  }
}