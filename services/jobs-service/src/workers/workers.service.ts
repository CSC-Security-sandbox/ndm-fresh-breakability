import { BadRequestException, Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';

import { WorkerEntity } from 'src/entities/worker.entity';
import { WorkersStatusPageDto } from './dto/workers.page.dto';
import { WorkerStatus } from 'src/constants/enums';
import { HealthStatus } from './worker.types';
import { ConfigService } from '@nestjs/config';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class WorkersService {
  private readonly logger: LoggerService;
  constructor(
    @InjectRepository(WorkerEntity)
    private readonly WorkerEntity: Repository<WorkerEntity>,
    @InjectRepository(WorkerJobRunMap)
    private readonly workerJobRunMap: Repository<WorkerJobRunMap>,
    private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(WorkersService.name);
  }

  updateWorkerStatus(workers: WorkerEntity[]) {
    const timeout = this.configService.get(
      'app.worker.healthCheckStatusTimout',
    );
    return workers.map((worker) => {
      if (!worker.stats || !worker.stats?.healthStatus) {
        worker.status = WorkerStatus.Offline;
      } else {
        const updatedAt = new Date(worker.stats.updatedAt);
        const currentTime = new Date();
        const timeDiff = Math.abs(currentTime.getTime() - updatedAt.getTime());
        const diffInSeconds = Math.floor(timeDiff / 1000);
        if (
          diffInSeconds >= timeout ||
          worker.stats.healthStatus !== HealthStatus.Healthy
        ) {
          worker.status = WorkerStatus.Offline;
        } else {
          worker.status = WorkerStatus.Online;
        }
      }
      return worker;
    });
  }

  async findAllWorkers(workerStatusPageDto: WorkersStatusPageDto) {
    const {
      page,
      limit,
      sort = 'createdAt',
      order = 'ASC',
      jobRunId,
      fileServerId,
      ...filter
    } = workerStatusPageDto;

    let relations = ['stats'];

    const whereCondition: any = { ...filter };
    const updateFilter: any = { ...filter };
    if (jobRunId) {
      whereCondition.jobRunMap = { jobRunId };
      updateFilter.jobRunMap = { jobRunId };
    }

    const findOptions: FindManyOptions<WorkerEntity> = {
      where: whereCondition,
      order: { [sort]: order },
      relations: relations,
    };

    if (fileServerId) {
      relations = [...relations, 'fileServers'];
      findOptions.relations = relations;
      findOptions.where = {
        ...findOptions.where,
        fileServers: { id: fileServerId },
      };
    }

    let data = [],
      total = 0;
    if (page && limit) {
      findOptions.skip = (parseInt(page) - 1) * parseInt(limit);
      findOptions.take = parseInt(limit);
      data = await this.WorkerEntity.find(findOptions);
      total = await this.WorkerEntity.count({ where: updateFilter });
    } else {
      data = await this.WorkerEntity.find(findOptions);
      total = await this.WorkerEntity.count({ where: updateFilter });
    }
    const workerWithStatusUpdated = this.updateWorkerStatus(data);
    return workerWithStatusUpdated;
  }

  async updateWorkerJobRunStatus(
    workerId: string,
    jobrunId: string,
    active: boolean,
  ) {
    const workerJobMap = await this.workerJobRunMap.findOne({
      where: {
        workerId: workerId,
        jobRunId: jobrunId,
      },
    });
    if (!workerJobMap)
      throw new BadRequestException(
        `Worker Job Run mapping not found for workerId: ${workerId} and jobrunId: ${jobrunId}`,
      );

    workerJobMap.isActive = active;
    return await this.workerJobRunMap.save(workerJobMap);
  }
}
