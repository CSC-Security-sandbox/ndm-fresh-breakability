


import { proxyActivities, log } from '@temporalio/workflow';
import { ActivitiesService } from 'src/activities/activities.service';
import { QueryList } from 'src/activities/discovery-report/discovery-report.query-mapper';
import { DiscoveryReportSection } from 'src/activities/discovery-report/discovery-report.type';

const { generateDiscoveryJsonReport } =
  proxyActivities<ActivitiesService>({
    startToCloseTimeout: '10h',
    retry: {
      maximumAttempts: 3,
      maximumInterval: '3s',
    },
});

const { generateDiscoveryPdfReport, generateDiscoveryCsvReport } =
  proxyActivities<ActivitiesService>({
    startToCloseTimeout: '10m',
    retry: {
      maximumAttempts: 3,
      maximumInterval: '3s',
    },
});

interface GenerateDiscoveryReportWorkflowInput {
  jobRunId: string;
}

export const GenerateDiscoveryReportWorkflow = async ({ jobRunId }: GenerateDiscoveryReportWorkflowInput) => {

  const output: DiscoveryReportSection[] = [];

  const results = await Promise.allSettled(
    QueryList.map(async (section) =>
      await generateDiscoveryJsonReport({ jobRunId, section })
    )
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      output.push(...result.value)
    } else {
      log.error(`Failed to generate report for section ${QueryList[index]}: ${result.reason}`);
    }
  });

  await Promise.allSettled(
    [
      generateDiscoveryPdfReport(output),
      generateDiscoveryCsvReport(output)
    ]
  )
  
  return output
};
