import { Controller, Get, Post, Put, Delete, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JobMappingService } from './jobmapping.service';
import { JobMappingEntity } from '../entities/jobmapping.entity';
import { CreateJobMappingDto } from '../dto/rolemapping.dto';

@ApiTags('Job Mapping')
@Controller('job-mapping')
export class JobMappingController {
  constructor(private readonly jobMappingService: JobMappingService) {}

  @ApiOperation({ summary: 'Get all job mappings' })
  @ApiResponse({ status: 200, description: 'List of job mappings', type: [JobMappingEntity] })
  @Get()
  async getAll(): Promise<JobMappingEntity[]> {
    return this.jobMappingService.findAll();
  }

  @ApiOperation({ summary: 'Get a job mapping by ID' })
  @ApiResponse({ status: 200, description: 'Job mapping found', type: JobMappingEntity })
  @ApiResponse({ status: 404, description: 'Job mapping not found' })
  @Get(':id')
  async getById(@Param('id') id: string): Promise<JobMappingEntity> {
    const jobMapping = await this.jobMappingService.findOne(id);
    if (!jobMapping) {
      throw new HttpException('Job mapping not found', HttpStatus.NOT_FOUND);
    }
    return jobMapping;
  }

  @ApiOperation({ summary: 'Create a new job mapping' })
  @ApiResponse({ status: 201, description: 'Job mapping created', type: JobMappingEntity })
  @Post()
  async create(@Body() data: CreateJobMappingDto): Promise<JobMappingEntity> {
    return this.jobMappingService.create(data);
  }

  @ApiOperation({ summary: 'Update an existing job mapping' })
  @ApiResponse({ status: 200, description: 'Job mapping updated', type: JobMappingEntity })
  @ApiResponse({ status: 404, description: 'Job mapping not found' })
  @Put(':id')
  async update(@Param('id') id: string, @Body() data: Partial<JobMappingEntity>): Promise<JobMappingEntity> {
    const updatedJobMapping = await this.jobMappingService.update(id, data);
    if (!updatedJobMapping) {
      throw new HttpException('Job mapping not found', HttpStatus.NOT_FOUND);
    }
    return updatedJobMapping;
  }

  @ApiOperation({ summary: 'Delete a job mapping' })
  @ApiResponse({ status: 200, description: 'Job mapping deleted' })
  @ApiResponse({ status: 404, description: 'Job mapping not found' })
  @Delete(':id')
  async delete(@Param('id') id: string): Promise<{ message: string }> {
    const deleted = await this.jobMappingService.delete(id);
    if (!deleted) {
      throw new HttpException('Job mapping not found', HttpStatus.NOT_FOUND);
    }
    return { message: 'Job mapping deleted successfully' };
  }
}
