import * as wf from '@temporalio/workflow';
import { JobReportType } from './reporting.types';
import { MigrationTaskService } from '../../activities/migrate/migrate.taskmanager.service';
import { JobRunStatus } from '../../activities/discovery/enums';
import { DiscoveryActivity } from '../../activities/discovery/discovery.activities';
import { CommonActivityService } from '../../activities/common/common.service';
import { isErrored } from 'stream';

export const isReportedQuery = wf.defineQuery<boolean>('isReported');


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
    isErrored: boolean,
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
      switch(reportType) {
        case JobReportType.CUT_OVER: {
            await updateStatusActivity({jobRunId: traceId, status: isErrored ? JobRunStatus.Errored :JobRunStatus.BLOCKED})
            await generateCOCReportActivity(traceId);
            await generateJobsReportActivity(traceId);
            break
        }
        case JobReportType.DISCOVER: {
            await updateStatusActivity({jobRunId: traceId, status: isErrored ? JobRunStatus.Errored :JobRunStatus.Completed})
            await generateDiscoveryReportActivity(traceId)
            break
        }
        case JobReportType.MIGRATE: {
            await updateStatusActivity({jobRunId: traceId, status: isErrored ? JobRunStatus.Errored :JobRunStatus.Completed})
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