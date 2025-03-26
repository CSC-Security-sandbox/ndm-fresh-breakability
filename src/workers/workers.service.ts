import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { FindManyOptions, Repository } from "typeorm";

import { WorkerEntity } from "src/entities/worker.entity";
import { WorkersStatusPageDto } from "./dto/workers.page.dto";

@Injectable()
export class WorkersService {
  private logger: Logger = new Logger(WorkersService.name);

  constructor(
    @InjectRepository(WorkerEntity)
    private readonly WorkerEntity: Repository<WorkerEntity>
  ) {}

  async findAllWorkers(workerStatusPageDto: WorkersStatusPageDto) {
    const {
      page,
      limit,
      jobRunId,
      sort = "createdAt",
      order = "ASC",
      ...filter
    } = workerStatusPageDto;

    const whereCondition: any = { ...filter };
    if (jobRunId) {
      whereCondition.jobRunMap = { jobRunId };
    }

    const findOptions: FindManyOptions<WorkerEntity> = {
      where: whereCondition,
      order: { [sort]: order },
    };

    let data = [],
      total = 0;
    if (page && limit) {
      findOptions.skip = (parseInt(page) - 1) * parseInt(limit);
      findOptions.take = parseInt(limit);
      data = await this.WorkerEntity.find(findOptions);
      total = await this.WorkerEntity.count({ where: filter });
    } else {
      data = await this.WorkerEntity.find(findOptions);
      total = await this.WorkerEntity.count({ where: filter });
    }
    return { data, total };
  }
}
