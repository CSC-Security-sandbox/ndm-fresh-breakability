import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WorkerStatsEntity } from 'src/entities/worker-stats.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { Repository } from 'typeorm';
import { HealthcheckStats } from './dto/healthcheck.dto';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class HealthcheckService {
  // This service will handle the logic for health checks
  private readonly logger: LoggerService;

  constructor(
    @InjectRepository(WorkerStatsEntity)
    private workerStatsEntity: Repository<WorkerStatsEntity>,
    @InjectRepository(WorkerEntity)
    private workerEntity: Repository<WorkerEntity>,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(HealthcheckService.name);
  }

  async createOrUpdateHealthCheckStats(
    healthStats: HealthcheckStats,
  ): Promise<void> {
    try {
      // Implement the logic to create or update health check stats
      const { workerId, healthStatus, systemStats } = healthStats;
      // Check if the worker exists
      const worker = await this.workerEntity.findOne({
        where: { workerId },
        relations: ['stats'],
      });
      if (!worker) {
        // Handle the case where the worker does not exist
        throw new Error(`Worker with ID ${workerId} does not exist`);
      }

      let statsEntity = worker.stats;
      if (statsEntity) {
        // Update existing record
        statsEntity.healthStatus = healthStatus;
        statsEntity.systemStats = systemStats;
        //if data is not changed then also updated_at column should get updated.
        statsEntity.updatedAt = new Date();
      } else {
        statsEntity = this.workerStatsEntity.create({
          healthStatus: healthStatus,
          systemStats: systemStats,
          workerId: workerId,
        });
      }
      await this.workerStatsEntity.save(statsEntity);
    } catch (error) {
      this.logger.error(
        `Error creating or updating health check stats: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
