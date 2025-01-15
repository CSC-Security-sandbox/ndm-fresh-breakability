import { Injectable, Logger } from '@nestjs/common';
import { TaskQueryParamsDto } from './dto/taskpage.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { TaskEntity } from 'src/entities/task.entity';
import { FindManyOptions, In, Repository } from 'typeorm';

@Injectable()
export class TasksService {

    private logger: Logger = new Logger(TasksService.name);

    constructor(
        @InjectRepository(TaskEntity)
        private readonly taskRepo: Repository<TaskEntity>,
      ) {}


    async getTaskList(taskQuery: TaskQueryParamsDto) {
        const { page, limit, sort = 'createdAt', order = 'ASC', jobRunId, ...filter } = taskQuery;

        let where = {jobRunId}
        
        Object.keys(filter).forEach((k)=>{
            where =  {...where, [k]: In(filter[k])}
        })

        const findOptions: FindManyOptions<TaskEntity> = {
            where, order: { [sort]: order }, 
          };
      
          let data = [], total = 0;
          if (page && limit) {
            findOptions.skip = (parseInt(page) - 1) * parseInt(limit); 
            findOptions.take = parseInt(limit); 
            data = await this.taskRepo.find(findOptions);
            total = await this.taskRepo.count({ where});
          } else {
            data = await this.taskRepo.find(findOptions);
            total = await this.taskRepo.count({ where });
          }
          return { data, total };
    }
}
