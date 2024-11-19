import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobMappingEntity } from '../entities/jobmapping.entity';
import { CreateJobMappingDto, UpdateJobMappingDto } from '../dto/rolemapping.dto';

@Injectable()
export class JobMappingService {
  constructor(
    @InjectRepository(JobMappingEntity)
    private readonly jobMappingRepository: Repository<JobMappingEntity>,
  ) {}

  async findAll(): Promise<JobMappingEntity[]> {
    return this.jobMappingRepository.find();
  }

  async findOne(id: string): Promise<JobMappingEntity | null> {
    return this.jobMappingRepository.findOne({ where: { id } });
  }

  async create(createJobMappingDto: CreateJobMappingDto): Promise<JobMappingEntity> {
    const newJobMapping = this.jobMappingRepository.create(createJobMappingDto);
    return this.jobMappingRepository.save(newJobMapping);
  }

  async update(id: string, updateJobMappingDto: UpdateJobMappingDto): Promise<JobMappingEntity | null> {
    const existingJobMapping = await this.jobMappingRepository.findOne({ where: { id } });

    if (!existingJobMapping) {
      return null;
    }

    const updatedJobMapping = this.jobMappingRepository.merge(existingJobMapping, updateJobMappingDto);
    return this.jobMappingRepository.save(updatedJobMapping);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.jobMappingRepository.delete(id);
    return result.affected > 0;
  }
}