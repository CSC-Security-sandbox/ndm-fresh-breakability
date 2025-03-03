import { proxyActivities } from '@temporalio/workflow';
import { SetupActivityService } from 'src/activities/setup-worker/setup.activity.service';

const { mountAndCheckWritePermission: mountAndCheckWritePermissionActivity } =
  proxyActivities<SetupActivityService>({ startToCloseTimeout: '3000s' });

async function log(traceId: string, message: string) {
    console.log(`[${traceId}] ${message}`);
  }
  
export async function PreCheckMountAndWritePermissionValidation(
  args: any,
): Promise<any> {
  const { traceId, fileServer, feature } = args;
  log(traceId,
    `[PreCheckMountAndWritePermissionValidation],
    ${JSON.stringify(fileServer)}`,
  );
  const mountResult =  await mountAndCheckWritePermissionActivity(
    fileServer,
    traceId,
    feature.checkWritePermission,
  );
 log(traceId,`[PreCheckMountAndWritePermissionValidation Result]', ${JSON.stringify(mountResult)}`);
  return mountResult;
}
