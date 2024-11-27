import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobIdMappingEntity } from '../entities/jobmapping.entity';
import { AccessControlMapping, UpdateJobMappingDto } from '../dto/rolemapping.dto';

@Injectable()
export class JobMappingService {
  constructor(
    @InjectRepository(JobIdMappingEntity)
    private jobMappingRepository: Repository<JobIdMappingEntity>,
  ) {}

  async findAll(): Promise<JobIdMappingEntity[]> {
    return this.jobMappingRepository.find();
  }

  async findOne(id: string): Promise<JobIdMappingEntity | null> {
    return this.jobMappingRepository.findOne({ where: { id } });
  }

  async create(createJobMappingDto: AccessControlMapping): Promise<JobIdMappingEntity> {
    const newJobMapping = this.jobMappingRepository.create(createJobMappingDto);
    return this.jobMappingRepository.save(newJobMapping);
  }

  async createMany(createJobMappingDtos: AccessControlMapping[]): Promise<JobIdMappingEntity[]> {
    const newJobMappings = createJobMappingDtos.map(dto => this.jobMappingRepository.create(dto));
    return await this.jobMappingRepository.save(newJobMappings);
  }

  async update(id: string, updateJobMappingDto: UpdateJobMappingDto): Promise<JobIdMappingEntity | null> {
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