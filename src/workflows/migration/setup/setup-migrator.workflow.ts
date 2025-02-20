import { proxyActivities } from '@temporalio/workflow';

import type * as setupActivity from '../../../activities/setup-worker/setup-worker'


async function log(traceId: string, message: string) {
    console.log(`[${traceId}] ${message}`);
}

const {setup: setupWorkerActivity} = proxyActivities<typeof setupActivity>({startToCloseTimeout: '300s'})


export const SetupMigratorWorkFlow = async (args: any) => {
    log( args.traceId, `Starting SetupMigratorWorkFlow with args: ${JSON.stringify(args)}`);
    return  await setupWorkerActivity(args.jobRunId);
}