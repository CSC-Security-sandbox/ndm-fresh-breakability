


import { proxyActivities, log } from '@temporalio/workflow';
import { ActivitiesService } from 'src/activities/activities.service';
import { DiscoveryReportSection } from 'src/activities/discovery-report/discovery-report.type';
import { DynamicMaps, QueryList } from 'src/activities/discovery-report/query/discovery-report.query-mapper';

const { generateDiscoveryJsonReport } =
  proxyActivities<ActivitiesService>({
    startToCloseTimeout: '1h',
    retry: {
      maximumAttempts: 3,
      maximumInterval: '3s',
    },
});

const { generateDiscoveryPdfReport, generateDiscoveryCsvReport , updateDiscoveryReport} =
  proxyActivities<ActivitiesService>({
    startToCloseTimeout: '10m',
    retry: {
      maximumAttempts: 3,
      maximumInterval: '3s',
    },
});

interface GenerateDiscoveryReportWorkflowInput {
  jobRunId: string;
  projectId?: string;
}

export const GenerateDiscoveryReportWorkflow = async ({ jobRunId, projectId }: GenerateDiscoveryReportWorkflowInput) => {
  const logPrefix = projectId ? `projectId: ${projectId}` : `jobRunId: ${jobRunId}`;
  log.info(`${logPrefix} Starting discovery report workflow for jobRunId: ${jobRunId}`);

  const output: DiscoveryReportSection[] = [];

  // ----------------- Batch Section Proccess for Fixed size output Start -------------- //
  const results = await Promise.allSettled(
    QueryList.map(async (section) =>
      await generateDiscoveryJsonReport({ jobRunId, section, updateSection: false })
    )
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      output.push(...result.value)
    } else {
      log.error(`${logPrefix} Failed to generate report for section ${QueryList[index]} for jobRunId: ${jobRunId}: ${result.reason}`);
    }
  });

  await updateDiscoveryReport({
    jobRunId,
    data: output,
    updateType: 'data'
  });
  // ----------------- Batch Section Proccess for Fixed size End -------------- //

   // ----------------- Dynamic Section Proccess Start -------------- //
  for(const section of DynamicMaps) {
    await generateDiscoveryJsonReport({ jobRunId, section, updateSection: true });
  }
  // ----------------- Dynamic Section Process End -------------- //

  log.info(`${logPrefix} Generating PDF and CSV reports for jobRunId: ${jobRunId}`);
  const fileResults = await Promise.allSettled([
    generateDiscoveryPdfReport({ jobRunId }),
    generateDiscoveryCsvReport({ jobRunId }),
  ]);

  const [pdfResult, csvResult] = fileResults;
  if (pdfResult.status === 'rejected') {
    log.error(`${logPrefix} PDF generation failed for jobRunId: ${jobRunId}: ${pdfResult.reason}`);
  } else {
    log.info(`${logPrefix} PDF generation succeeded for jobRunId: ${jobRunId}`);
  }
  if (csvResult.status === 'rejected') {
    log.error(`${logPrefix} CSV generation failed for jobRunId: ${jobRunId}: ${csvResult.reason}`);
  } else {
    log.info(`${logPrefix} CSV generation succeeded for jobRunId: ${jobRunId}`);
  }

  log.info(`${logPrefix} Updating final status for jobRunId: ${jobRunId}`);
  await updateDiscoveryReport({
    jobRunId,
    updateType: 'status'
  });

  log.info(`${logPrefix} Completed discovery report workflow for jobRunId: ${jobRunId}`);

  return output
};
