import * as wf from '@temporalio/workflow';
import { MigrationTaskService } from 'src/activities/migrate/migrate.taskmanager.service';
import { JobRunStatus } from 'src/activities/discovery/enums';
import { DiscoveryActivity } from 'src/activities/discovery/discovery.activities';
import { CommonActivityService } from 'src/activities/common/common.service';
import { WorkflowStatus } from '../chid-scan.workflow.type';
import { JobReportType } from './common.types';


const isReportedQuery = wf.defineQuery<boolean>('isReported');


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
  

export const ReportingWorkflow = async (
    traceId: string,
    signal: wf.SignalDefinition<[string], string>,
    workflowStatus: WorkflowStatus,
  ): Promise<string> => {
    let isBlocked = true;
    let reportType : JobReportType | null 
  
    wf.setHandler(isReportedQuery, () =>!isBlocked);
  
    wf.setHandler(signal, (input: string) => {
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
      const jobRunStatus = getMappedJobRunStatus(workflowStatus, reportType);
      await updateStatusActivity({jobRunId: traceId, status: jobRunStatus})
      switch(reportType) {
        case JobReportType.CUT_OVER: {            
            await generateCOCReportActivity(traceId);
            await generateJobsReportActivity(traceId);
            break
        }
        case JobReportType.DISCOVER: {
            await updateStatusActivity({jobRunId: traceId, status:jobRunStatus})
            await generateDiscoveryReportActivity(traceId)
            break
        }
        case JobReportType.MIGRATE: {
            await updateStatusActivity({jobRunId: traceId, status: jobRunStatus})
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


  function getMappedJobRunStatus(workflowStatus: WorkflowStatus, jobType: JobReportType): JobRunStatus {
      if (workflowStatus === WorkflowStatus.Failed) {
        return JobRunStatus.Errored;
      }
      if( workflowStatus === WorkflowStatus.Completed && jobType === JobReportType.CUT_OVER) {
        return JobRunStatus.BLOCKED;
      }
      return workflowStatus === WorkflowStatus.Completed ? JobRunStatus.Completed : JobRunStatus.Stopped;
  }


