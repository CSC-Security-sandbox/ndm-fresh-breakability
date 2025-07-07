import * as wf from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { DiscoveryActivity } from 'src/activities/discovery/discovery.activities';
import { JobRunStatus } from 'src/activities/discovery/enums';
import { MigrationTaskService } from 'src/activities/migrate/migrate.taskmanager.service';



const isReportedQuery = wf.defineQuery<boolean>('isReported');
const reportingSignal =  wf.defineSignal<[string]>('reportingSignal');

const {
    generateDiscoveryReport: generateDiscoveryReportActivity
  } = wf.proxyActivities<DiscoveryActivity>({ startToCloseTimeout: '5h' });

const {
  generateCOCReport: generateCOCReportActivity,
} = wf.proxyActivities<MigrationTaskService>({ startToCloseTimeout: '5h' });



const {
  updateStatus: updateStatusActivity,
  generateJobsReport: generateJobsReportActivity,
} = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h' });


export  enum  JobReportType {
  MIGRATE = 'MIGRATE_REPORTED',
  CUT_OVER = 'CUT_OVER_REPORTED',
  DISCOVER= 'DISCOVER_REPORTED'
}

export const handleReporting = async (
    traceId: string,
    status: JobRunStatus,
  ): Promise<string> => {
    let isBlocked = true;
    let reportType : JobReportType | null 
  
    wf.setHandler(isReportedQuery, () =>!isBlocked);
  
    wf.setHandler(reportingSignal, (input: string) => {
      console.log("Received reporting signal with input:", input);
      if(
            (input === JobReportType.CUT_OVER) ||
            (input === JobReportType.MIGRATE) ||
            (input === JobReportType.DISCOVER) 
        ) 
        reportType = input
        isBlocked = false;
    });

    wf.log.info('Waiting for reporting signal...');
    try {
      await wf.condition(() => !isBlocked);
      
      const jobRunStatus = getMappedJobRunStatus(status, reportType);
      console.log(`resume reporting execution: ${jobRunStatus}`);
      await updateStatusActivity({jobRunId: traceId, status: jobRunStatus})
      console.log(`status updated: ${jobRunStatus}`);
      switch(reportType) {
        case JobReportType.CUT_OVER: {            
            await generateCOCReportActivity(traceId);
            await generateJobsReportActivity(traceId);
            break
        }
        case JobReportType.DISCOVER: {
            await generateDiscoveryReportActivity(traceId)
            break
        }
        case JobReportType.MIGRATE: {
            console.log(`Reporting for MIGRATE: ${traceId} with status: ${jobRunStatus}`);
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
    console.log(`Reporting completed for traceId: ${traceId} with status: ${status}`);
    return 'REPORTING COMPLETED'
  };


  function getMappedJobRunStatus(status: JobRunStatus, jobType: JobReportType): JobRunStatus {
      if(status === JobRunStatus.Completed && jobType === JobReportType.CUT_OVER) 
        return JobRunStatus.BLOCKED;
      return status ;
  }


