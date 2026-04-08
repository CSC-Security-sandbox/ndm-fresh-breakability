import * as wf from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { JobRunStatus } from 'src/activities/common/enums';



const isReportedQuery = wf.defineQuery<boolean>('isReported');
const reportingSignal =  wf.defineSignal<[string]>('reportingSignal');

const {
    generateCOCReport: generateCOCReportActivity,
  } = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '10m', retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 } });


const {
  updateStatus: updateStatusActivity,
  generateJobsReport: generateJobsReportActivity,
  updateWorkerResponse: updateWorkerResponseActivity,
  addExcludedSkippedEntries: addExcludedSkippedEntriesActivity,
} = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '10m', retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 } });


export  enum  JobReportType {
  MIGRATE = 'MIGRATE_REPORTED',
  CUT_OVER = 'CUT_OVER_REPORTED',
  DISCOVER= 'DISCOVER_REPORTED',
  RETRY = 'RETRY_REPORTED',
  DB_WRITER_FAILURE = 'DB_WRITER_FAILURE_REPORTED',
}

const generateReport = async (jobRunId: string, generator: string) => {
  await wf.startChild(generator, {
    args: [ { jobRunId } ],
    workflowId: `${generator}-${jobRunId}-report`,
    taskQueue: `reports-TaskQueue`,
    cancellationType: wf.ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
    parentClosePolicy: wf.ParentClosePolicy.ABANDON,
  });
};

export interface WorkflowStats {
    fileCount?: number;
    dirCount?: number;
    totalSize?: string;
    excludedPaths?: Array<{ path: string; isDirectory?: boolean; matchedPattern?: string }>;
    skippedPaths?: Array<{ path: string; isDirectory?: boolean }>;
}

export const handleReporting = async (
    traceId: string,
    status: JobRunStatus,
    stats?: WorkflowStats,
  ): Promise<string> => {
    let isBlocked = true;
    let reportType : JobReportType | null = null;
  
    wf.setHandler(isReportedQuery, () =>!isBlocked);
  
    wf.setHandler(reportingSignal, (input: string) => {
      if(
            (input === JobReportType.CUT_OVER) ||
            (input === JobReportType.MIGRATE) ||
            (input === JobReportType.DISCOVER) ||
            (input === JobReportType.RETRY) ||
            (input === JobReportType.DB_WRITER_FAILURE)
        ) {
        reportType = input;
        isBlocked = false;
      }
    });

    wf.log.info('Waiting for reporting signal...');
    try {
      await wf.condition(() => !isBlocked);
      const jobRunStatus = getMappedJobRunStatus(status, reportType);
      if (stats?.excludedPaths?.length || stats?.skippedPaths?.length) {
        await addExcludedSkippedEntriesActivity(
          traceId,
          stats.excludedPaths ?? [],
          stats.skippedPaths ?? [],
        );
      }
      await updateStatusActivity({
        jobRunId: traceId,
        status: jobRunStatus,
      });
      switch(reportType) {
        case JobReportType.CUT_OVER: {            
            await generateCOCReportActivity(traceId);
            await generateJobsReportActivity(traceId);
            break
        }
        case JobReportType.DISCOVER: {            
            await generateReport(traceId, 'GenerateDiscoveryReportWorkflow')
            break
        }
        case JobReportType.MIGRATE: {            
            await generateCOCReportActivity(traceId)
            break
        }
        case JobReportType.RETRY: {            
            // Retry uses the same reporting as regular migration
            await generateCOCReportActivity(traceId)
            break
        }
        case JobReportType.DB_WRITER_FAILURE: {
            wf.log.warn(`DB writer worker threads exhausted retries for job ${traceId}, skipping report generation`);
            await updateWorkerResponseActivity(traceId, 'all', {
                status: JobRunStatus.Failed,
                code: 'DB_WRITER_FAILURE',
                operation: 'DB Writer Failure',
                occurrence: 1,
                origin: 'DbWriterService',
                message: 'Job failed: DB writer worker threads exhausted all retries after repeated crashes. Data writing was aborted.',
                createdAt: new Date(),
            });
            break
        }
        default:
            throw new Error('Unknown REPORT TYPE')
      }
  
    } catch (err) {
      if (err instanceof wf.CancelledFailure) {
        wf.log.info('Workflow cancelled');
      }
      throw err;
    }
  
    return 'REPORTING COMPLETED'
  };


function getMappedJobRunStatus(status: JobRunStatus, jobType: JobReportType): JobRunStatus {
  if (jobType === JobReportType.DB_WRITER_FAILURE) return JobRunStatus.Failed;
  if(status === JobRunStatus.Completed && jobType === JobReportType.CUT_OVER) 
    return JobRunStatus.BLOCKED;
  return status ;
}