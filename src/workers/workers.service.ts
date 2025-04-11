import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { FindManyOptions, Repository } from "typeorm";

import { WorkerEntity } from "src/entities/worker.entity";
import { WorkersStatusPageDto } from "./dto/workers.page.dto";
import { WorkerStatus } from "src/constants/enums";
import { HealthStatus } from "./worker.types";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class WorkersService {
  private logger: Logger = new Logger(WorkersService.name);
  constructor(
    @InjectRepository(WorkerEntity)
    private readonly WorkerEntity: Repository<WorkerEntity>,
    private readonly configService: ConfigService,
  ) {}

  updateWorkerStatus(workers: WorkerEntity[]) {
    const timeout = this.configService.get(
      "app.worker.healthCheckStatusTimout",
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
      sort = "createdAt",
      order = "ASC",
      jobRunId,
      fileServerId,
      ...filter
    } = workerStatusPageDto;

    let relations = ["stats"];

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
      relations = [...relations, "fileServers"];
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
    return { data: workerWithStatusUpdated, total };
  }
}
