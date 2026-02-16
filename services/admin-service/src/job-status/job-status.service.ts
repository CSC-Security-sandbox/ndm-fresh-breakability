import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, IsNull, Repository } from 'typeorm';
import { JobRun } from '../entities/job-run.entity';
import { JobConfig } from '../entities/job-config.entity';
import {
  JobStatus,
  RUNNING_STATUSES,
} from '../constants/job-enums';
import {
  JobStatusResponseDto,
  RunningJobDto,
  ScheduledJobDto,
} from './dto/job-status-response.dto';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class JobStatusService {
  private readonly logger: LoggerService;

  constructor(
    @InjectRepository(JobRun)
    private readonly jobRunRepository: Repository<JobRun>,
    @InjectRepository(JobConfig)
    private readonly jobConfigRepository: Repository<JobConfig>,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(JobStatusService.name);
  }

  async getJobStatus(): Promise<JobStatusResponseDto> {
    this.logger.log('Fetching job status overview');

    const [runningJobs, scheduledJobs] = await Promise.all([
      this.getRunningJobs(),
      this.getActiveScheduledJobs(),
    ]);

    this.logger.log('Job status overview fetched', {
      runningJobsCount: runningJobs.length,
      scheduledJobsCount: scheduledJobs.length,
    });

    return {
      runningJobs,
      runningJobsCount: runningJobs.length,
      scheduledJobs,
      scheduledJobsCount: scheduledJobs.length,
    };
  }

  /**
   * Finds all job runs that are currently in a running state
   * (RUNNING, PENDING, PAUSING, STOPPING).
   */
  private async getRunningJobs(): Promise<RunningJobDto[]> {
    try {
      const jobRuns = await this.jobRunRepository.find({
        where: {
          status: In(RUNNING_STATUSES),
        },
        relations: ['jobConfig'],
        order: {
          startTime: 'DESC',
        },
      });

      return jobRuns.map((run) => ({
        jobRunId: run.id,
        jobConfigId: run.jobConfigId,
        jobType: run.jobConfig?.jobType ?? 'UNKNOWN',
        status: run.status,
        subStatus: run.subStatus,
        startTime: run.startTime,
        iterationNumber: run.iterationNumber,
        jobRunType: run.jobRunType,
      }));
    } catch (error) {
      this.logger.error('Failed to fetch running jobs', error);
      throw error;
    }
  }

  /**
   * Finds all job configs that are ACTIVE and have a schedule configured
   * (either firstRunAt or futureScheduleAt is set).
   */
  private async getActiveScheduledJobs(): Promise<ScheduledJobDto[]> {
    try {
      const scheduledJobs = await this.jobConfigRepository.find({
        where: [
          {
            status: JobStatus.Active,
            firstRunAt: Not(IsNull()),
          },
          {
            status: JobStatus.Active,
            futureScheduleAt: Not(IsNull()),
          },
        ],
        order: {
          created_at: 'DESC',
        },
      });

      return scheduledJobs.map((job) => ({
        jobConfigId: job.id,
        jobType: job.jobType,
        status: job.status,
        firstRunAt: job.firstRunAt,
        futureScheduleAt: job.futureScheduleAt,
        createdAt: job.created_at,
      }));
    } catch (error) {
      this.logger.error('Failed to fetch active scheduled jobs', error);
      throw error;
    }
  }
}
