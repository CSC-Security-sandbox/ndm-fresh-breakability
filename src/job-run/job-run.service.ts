import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { Repository } from 'typeorm';
import { InventoryStatusSummary, TaskStatusCount } from './job-run.type';
import { capitalize, covertBytes } from 'src/utils/mapper';
import { TaskEntity } from 'src/entities/task.entity';
import { JobRunDetailsResponseDto, TaskDto } from './dto/job-rundetails.dto';
import { ReportsEntity } from 'src/entities/reports.entity';
import { JobRunStatus, ReportType } from 'src/constants/enums';

@Injectable()
export class JobRunService {

    constructor(
        @InjectRepository(JobRunEntity)
        private jobRunRepo: Repository<JobRunEntity>,
        @InjectRepository(InventoryEntity)
        private inventoryRepo: Repository<InventoryEntity>,
        @InjectRepository(TaskEntity)
        private taskRepo: Repository<TaskEntity>,
        @InjectRepository(ReportsEntity)
        private reportsRepo: Repository<ReportsEntity>,
    ){}

    async getJobStatsId(id: string) {

        const saved = await this.reportsRepo.findOne({where: {jobRunId: id, reportType: ReportType.JOB_RUN_STATS}, select: {reportData: true}})
        if(saved) 
          return JSON.parse(saved.reportData)
        
        const volumeSearch = {
          volumePath: true,
          fileServer: {
            protocol: true,
            config: { configName: true }
          }
        };

        const jobRunRes : JobRunEntity= await this.jobRunRepo.findOne({
          where: { id },
          select: {
            id: true,
            startTime: true,
            status: true,
            endTime: true,
            workerMap: {workerId: true},
            jobConfig: {
              jobType: true,
              sourcePath: volumeSearch,
              targetPath: volumeSearch
            }
          },
          relations: {
            workerMap: true,
            jobConfig: {
              sourcePath: { fileServer: { config: true } },
              targetPath: { fileServer: { config: true } }
            }
          }
        });

        let jobRun : JobRunDetailsResponseDto = {
          ...jobRunRes,
          worker: jobRunRes.workerMap.map(it=>it.workerId)
        }

      

        const inventorySummary:InventoryStatusSummary[] = await this.inventoryRepo
            .createQueryBuilder('i')
            .select('i.is_directory', 'isDirectory')
            .addSelect('COUNT(i.is_directory)', 'counts')
            .addSelect('SUM(i.file_size)', 'totalFileSize')
            .where('i.job_run_id = :jobRunId', { jobRunId: id })
            .groupBy('i.is_directory')
            .getRawMany();

      
        for(let i = 0; i < inventorySummary.length; i++) {
            if(inventorySummary[i].isDirectory) 
                jobRun['scannedDirectoriesCount'] = inventorySummary[i].counts.toString()
            else {
                jobRun['scannedFileCount'] = inventorySummary[i].counts.toString()
                jobRun['totalScannedSize'] = covertBytes(Number(inventorySummary[i].totalFileSize))
            }
        }

        const taskStatusCounts: TaskStatusCount[] = await this.taskRepo
            .createQueryBuilder('t')
            .select('t.status', 'status')
            .addSelect('COUNT(1)', 'count')
            .where('t.job_run_id = :jobRunId', { jobRunId: id })
            .groupBy('t.status')
            .getRawMany();

        jobRun['task'] = new TaskDto()
        for(let i = 0; i < taskStatusCounts.length; i++) 
            jobRun['task'][taskStatusCounts[i].status?.toLowerCase()] = Number(taskStatusCounts[i].count)

        if(jobRun.status === JobRunStatus.Completed) {
          const report = this.reportsRepo.create({jobRunId: id, reportData: JSON.stringify(jobRun), reportType: ReportType.JOB_RUN_STATS})
          await this.reportsRepo.save(report)
        }
        return jobRun; 
      }
      
}
