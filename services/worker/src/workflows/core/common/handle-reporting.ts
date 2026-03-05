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
} = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '10m', retry: { maximumAttempts: 3, initialInterval: '30s', backoffCoefficient: 1 } });


export  enum  JobReportType {
  MIGRATE = 'MIGRATE_REPORTED',
  CUT_OVER = 'CUT_OVER_REPORTED',
  DISCOVER= 'DISCOVER_REPORTED'
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
            (input === JobReportType.DISCOVER) 
        ) 
        reportType = input;
        isBlocked = false;
    });

    wf.log.info('Waiting for reporting signal...');
    try {
      await wf.condition(() => !isBlocked);
      const jobRunStatus = getMappedJobRunStatus(status, reportType);
      await updateStatusActivity({
        jobRunId: traceId, 
        status: jobRunStatus,
        stats: stats ? {
          fileCount: stats.fileCount,
          dirCount: stats.dirCount,
          totalSize: stats.totalSize,
        } : undefined
      })
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
  if(status === JobRunStatus.Completed && jobType === JobReportType.CUT_OVER) 
    return JobRunStatus.BLOCKED;
  return status ;
}