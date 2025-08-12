import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as ping from 'ping';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PingWorkerService {
  private readonly logger = new Logger(PingWorkerService.name);

 private buffer: any[] = [];
  private pendingBatches: any[][] = [];
  private startTime: number | null = null;

  private readonly workerConfigUrl: string;
  private readonly controlPlaneIP: string;
  private readonly workerId: string;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    this.workerConfigUrl = `${this.configService.get('worker.connection.workerConfigUrl')}`;
    this.controlPlaneIP = this.configService.get('worker.controlPlaneIP');
    this.workerId = this.configService.get('worker.workerId');
  }

  @Cron('*/30 * * * * *') // every 30 seconds
  async collectNetworkLatency() {
    try {
      const measuredAt = new Date().toISOString();

      const res = await ping.promise.probe(this.controlPlaneIP, {
        timeout: 2,
        extra: ['-c', '5'],
      });

      this.logger.log(`Calling collectNetworkLatency for every 30 sec ${JSON.stringify(res)}`);
      
      const latencyData = {
        workerId: this.workerId,
        controlPlaneIP: this.controlPlaneIP,
        min: parseFloat(res.min),
        max: parseFloat(res.max),
        avg: parseFloat(res.avg),
        measuredAt,
      };

      if (!this.startTime) {
        this.startTime = Date.now();
      }

      this.buffer.push(latencyData);
      this.logger.log(`Collected (#${this.buffer.length}): ${JSON.stringify(latencyData)}`);

    //   const elapsedMinutes = (Date.now() - this.startTime) / (1000 * 60);

      // Every 10 minutes send the batch
    //   if (elapsedMinutes >= 10) {

    this.logger.log(`this.buffer - ${JSON.stringify(this.buffer)}`);
 this.logger.log(`this.pendingBatches - ${JSON.stringify(this.pendingBatches)}`);

        this.pendingBatches.push([...this.buffer]);
        this.buffer = [];
        this.startTime = null;
        await this.sendPendingBatches();
        this.logger.log("after sendPendingBatches method");
        
    //   }
    } catch (err) {
      this.logger.error(`Error collecting latency: ${err.message}`);
    }
  }

  private async sendPendingBatches() {
    const stillPending: any[][] = [];
    this.logger.log("inside sendPendingBatches");
    this.logger.log(`this.pendingBatches inside sendPendingBatches - ${JSON.stringify(this.pendingBatches)}`);

    for (const batch of this.pendingBatches) {
      try {
        await axios.post(`${this.workerConfigUrl}/api/v1/support-bundle/network-latency`, { measurements: batch }, { timeout: 10000 });
        this.logger.log(`Sent batch of ${batch.length} measurements`);
      } catch (err) {
        this.logger.error(`Failed to send batch: ${err.message}`);
        stillPending.push(batch);
      }
    }

    this.logger.log("after for loop in sendPendingBatches");

    this.pendingBatches = stillPending;
  }
}
