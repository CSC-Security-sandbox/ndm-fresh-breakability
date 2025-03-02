import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JobRunStatus, JobType, ReportType } from 'src/constants/enums';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { ReportsEntity } from 'src/entities/reports.entity';
import { TaskEntity } from 'src/entities/task.entity';
import { covertBytes } from 'src/utils/mapper';
import { Repository } from 'typeorm';
import { JobRunDetailsResponseDto, JobRunStats, TaskDto } from './dto/job-rundetails.dto';
import { InventoryStatusSummary, TaskStatusCount } from './job-run.type';

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

    async jobRunReportByJobRunId(jobRunId:string, reportType:string) {
      const report = await this.reportsRepo.findOne({
        where: { jobRunId: jobRunId , reportType: reportType},
        order: { createdAt: "DESC" },
        select: ["reportData"],
      });
      if(!report) throw new NotFoundException(`${reportType} - report is not generated yet`)
      if(report) return report.reportData
    }

    async getJobStatsId(id: string) {
          const getLatestReportStatus = await this.jobRunRepo.findOne({
            where: { id: id },
            select: ['isReportReady'],
          });
        const saved = await this.reportsRepo.findOne({where: {jobRunId: id, reportType: ReportType.JOB_RUN_STATS}, select: {reportData: true}})
        if (saved) {
          const parsedReport = JSON.parse(saved.reportData);
          if (parsedReport.isReportReady !==  getLatestReportStatus.isReportReady) {
            parsedReport.isReportReady = getLatestReportStatus.isReportReady;
            saved.reportData = JSON.stringify(parsedReport);
            await this.reportsRepo.update(
              { jobRunId: id, reportType: ReportType.JOB_RUN_STATS },
              { reportData: JSON.stringify(parsedReport) }
            );
          }
          return parsedReport;
        }
        
        const volumeSearch = {
          volumePath: true,
          fileServer: {
            protocol: true,
            config: { configName: true }
          }
        };

        const jobRun : JobRunEntity= await this.jobRunRepo.findOne({
          where: { id },
          select: {
            id: true,
            startTime: true,
            isReportReady:true,
            status: true,
            endTime: true,
            worker: {workerId: true},
            jobConfig: {
              id: true,
              jobType: true,
              sourcePath: volumeSearch,
              destinationPath: volumeSearch
            }
          },
          relations: {
            worker: true,
            jobConfig: {
              sourcePath: { fileServer: { config: true } },
              destinationPath: { fileServer: { config: true } }
            }
          }
        });

        if(!jobRun) throw new NotFoundException(`Jon Run Dues not exit for id :${id}`)
        let response : JobRunDetailsResponseDto = {
          ...jobRun,
          jobConfig:{
            id: jobRun.jobConfig.id,
            jobType: jobRun.jobConfig.jobType,
            sourceServer: {
              protocol: jobRun.jobConfig.sourcePath.fileServer.protocol,  
              path: jobRun.jobConfig.sourcePath.volumePath,  
              serverName: jobRun.jobConfig.sourcePath.fileServer.config.configName,  
            },
            destinationServer:{
              protocol: jobRun?.jobConfig?.destinationPath?.fileServer?.protocol,  
              path: jobRun?.jobConfig?.destinationPath?.volumePath,   
              serverName: jobRun?.jobConfig?.destinationPath?.fileServer?.config?.configName,  
            }
          },
          worker: jobRun.worker.length ?? 0
        }

      

        const inventorySummary:InventoryStatusSummary[] = await this.inventoryRepo
            .createQueryBuilder('i')
            .select('i.is_directory', 'isDirectory')
            .addSelect('COUNT(i.is_directory)', 'counts')
            .addSelect('SUM(i.file_size)', 'totalFileSize')
            .where('i.job_run_id = :jobRunId', { jobRunId: id })
            .groupBy('i.is_directory')
            .getRawMany();

        const jobRunStatus = new JobRunStats()
        for(let i = 0; i < inventorySummary.length; i++) {
            if(inventorySummary[i].isDirectory) 
              jobRunStatus.directories = inventorySummary[i].counts.toString()
            else {
              jobRunStatus.fileCount = inventorySummary[i].counts.toString()
              jobRunStatus.totalSize = covertBytes(Number(inventorySummary[i].totalFileSize)).toString()
            }
        }
        
        if(jobRun.jobConfig.jobType===JobType.Discover)
          response['discovery'] = jobRunStatus
        if(jobRun.jobConfig.jobType === JobType.Migrate) 
          response['migrate'] = jobRunStatus
        if(jobRun.jobConfig.jobType === JobType.CutOver) 
          response['cutOver'] = jobRunStatus


        const taskStatusCounts: TaskStatusCount[] = await this.taskRepo
            .createQueryBuilder('t')
            .select('t.status', 'status')
            .addSelect('COUNT(1)', 'count')
            .where('t.job_run_id = :jobRunId', { jobRunId: id })
            .groupBy('t.status')
            .getRawMany();

        response['task'] = new TaskDto()
        for(let i = 0; i < taskStatusCounts.length; i++) 
            response['task'][taskStatusCounts[i].status?.toLowerCase()] = Number(taskStatusCounts[i].count)

        if(response.status === JobRunStatus.Completed) {
          const report = this.reportsRepo.create({jobRunId: id, reportData: JSON.stringify(response), reportType: ReportType.JOB_RUN_STATS})
          await this.reportsRepo.save(report)
        }
        return response; 
      }
      
}
