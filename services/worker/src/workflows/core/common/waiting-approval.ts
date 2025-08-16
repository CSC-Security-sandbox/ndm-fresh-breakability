import * as wf from '@temporalio/workflow';
import { CommonActivityService } from 'src/activities/common/common.service';
import { CutOverStatus } from 'src/activities/common/enums';


export  enum  JobReportType {
    MIGRATE = 'MIGRATE_REPORTED',
    CUT_OVER = 'CUT_OVER_REPORTED',
    DISCOVER= 'DISCOVER_REPORTED'
}

const {
  updateCutOverStatus: updateCutOverStatusActivity
} = wf.proxyActivities<CommonActivityService>({ startToCloseTimeout: '5h' });

export const approveSignal =  wf.defineSignal<[string]>('approve');
export const isBlockedQuery = wf.defineQuery<boolean>('isBlocked');

export const waitForApproval = async (
  jobRunId: string,
): Promise<string> => {
  let isBlocked = true;
  let approval_status: CutOverStatus | undefined;

  wf.setHandler(isBlockedQuery, () => isBlocked);

  wf.setHandler(approveSignal, (input: string) => {
    console.error(input)
    if((input == CutOverStatus.APPROVED) || (input == CutOverStatus.REJECTED) ) {
      approval_status = input;
      isBlocked = false;
    }
  });

  wf.log.info('Waiting for approval...');

  try {
    await wf.condition(() => !isBlocked);
    await updateCutOverStatusActivity({jobRunId, status: approval_status })
    wf.log.info(`Cutover approval received: ${approval_status}`);
    console.error(`Cutover approval received: ${approval_status}`);

  } catch (err) {
    if (err instanceof wf.CancelledFailure) {
      wf.log.info('Workflow cancelled');
    }
    throw err;
  }
  return approval_status ?? 'No approval received';
};