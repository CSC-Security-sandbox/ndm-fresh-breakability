import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { WorkerStatsEntity } from "src/entities/worker-stats.entity";
import { WorkerEntity } from "src/entities/worker.entity";
import { Repository } from "typeorm";
import { HealthcheckStats, SystemStats } from "./dto/healthcheck.dto";

@Injectable()
export class HealthcheckService {
  // This service will handle the logic for health checks
  private readonly logger = new Logger(HealthcheckService.name);
  constructor(
    @InjectRepository(WorkerStatsEntity)
    private workerStatsEntity: Repository<WorkerStatsEntity>,
    @InjectRepository(WorkerEntity)
    private workerEntity: Repository<WorkerEntity>,
  ) {}

  async createOrUpdateHealthCheckStats(
    healthStats: HealthcheckStats,
  ): Promise<void> {
    const queryRunner = this.workerStatsEntity.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // Implement the logic to create or update health check stats
      const { workerId, healthStatus, systemStats } = healthStats;
      // Check if the worker exists
      const worker = await this.workerEntity.findOne({
        where: { workerId },
        relations: ["stats"],
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
      await queryRunner.commitTransaction();
    } catch (error) {
        await queryRunner.rollbackTransaction();
        this.logger.error('Error creating or updating health check stats:', error);
        throw error;
    } finally {
        await queryRunner.release();
    }
  }
}
