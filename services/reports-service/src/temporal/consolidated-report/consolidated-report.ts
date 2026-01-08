import { proxyActivities, log } from '@temporalio/workflow';
import { ActivitiesService } from 'src/activities/activities.service';

const { 
  getDiscoveryJobsForFileServer,
  generatePdfForJobRun,
  mergePdfFilesActivity,
  getConsolidatedReportPathActivity,
  cleanupTempFilesActivity,
  updateConsolidatedReportStatus 
} = proxyActivities<ActivitiesService>({
  startToCloseTimeout: '30m',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10s',
    backoffCoefficient: 2,
  },
});

export interface GenerateConsolidatedReportWorkflowInput {
  fileServerId: string;
  configName: string;
}

export interface ConsolidatedReportJob {
  jobRunId: string;
  volumePath: string;
}

export interface ConsolidatedReportResult {
  fileServerId: string;
  status: 'COMPLETED' | 'FAILED' | 'PARTIAL';
  totalJobs: number;
  successfulJobs: number;
  failedJobs: number;
  failedVolumes: string[];
  reportPath?: string;
  errorMessage?: string;
}

export const GenerateConsolidatedReportWorkflow = async ({
  fileServerId,
  configName,
}: GenerateConsolidatedReportWorkflowInput): Promise<ConsolidatedReportResult> => {
  log.info(`Starting consolidated report workflow for fileServerId: ${fileServerId}`);

  const result: ConsolidatedReportResult = {
    fileServerId,
    status: 'COMPLETED',
    totalJobs: 0,
    successfulJobs: 0,
    failedJobs: 0,
    failedVolumes: [],
  };

  const tempFilePaths: string[] = [];

  try {
    log.info(`Fetching discovery jobs for fileServerId: ${fileServerId}`);
    const discoveryJobs = await getDiscoveryJobsForFileServer({ fileServerId });
    
    if (!discoveryJobs || discoveryJobs.length === 0) {
      result.status = 'COMPLETED';
      result.errorMessage = `No discovery jobs found for file server: ${fileServerId}. Please run discovery first.`;
      await updateConsolidatedReportStatus({ 
        fileServerId, 
        status: 'COMPLETED', 
        errorMessage: result.errorMessage,
        reportPath: null
      });
      return result;
    }

    result.totalJobs = discoveryJobs.length;
    log.info(`Found ${discoveryJobs.length} discovery jobs for consolidation`);

    const pdfFilePaths: string[] = [];
    
    const pdfResults = await Promise.all(
      discoveryJobs.map(async (job) => {
        try {
          log.info(`Generating PDF for jobRunId: ${job.jobRunId}, volumePath: ${job.volumePath}`);
          const pdfFilePath = await generatePdfForJobRun({ 
            jobRunId: job.jobRunId, 
            volumePath: job.volumePath 
          });
          
          if (pdfFilePath) {
            log.info(`Successfully generated PDF for jobRunId: ${job.jobRunId}`);
            return { success: true, pdfFilePath, volumePath: job.volumePath };
          } else {
            log.warn(`No PDF generated for jobRunId: ${job.jobRunId}`);
            return { success: false, volumePath: job.volumePath };
          }
        } catch (error) {
          log.error(`Failed to generate PDF for jobRunId: ${job.jobRunId}: ${error.message}`);
          return { success: false, volumePath: job.volumePath, error: error.message };
        }
      })
    );

    pdfResults.forEach((pdfResult) => {
      if (pdfResult.success) {
        pdfFilePaths.push(pdfResult.pdfFilePath);
        tempFilePaths.push(pdfResult.pdfFilePath);
        result.successfulJobs++;
      } else {
        result.failedJobs++;
        result.failedVolumes.push(pdfResult.volumePath);
      }
    });

    if (pdfFilePaths.length === 0) {
      result.status = 'FAILED';
      result.errorMessage = `All discovery job PDFs failed to generate. Failed volumes: ${result.failedVolumes.join(', ')}`;
      await updateConsolidatedReportStatus({ 
        fileServerId, 
        status: 'FAILED', 
        errorMessage: result.errorMessage,
      });
      return result;
    }

    log.info(`Getting output path for consolidated report`);
    const outputPath = await getConsolidatedReportPathActivity({ 
      fileServerId, 
      configName 
    });

    log.info(`Merging ${pdfFilePaths.length} PDFs to ${outputPath}`);
    const reportPath = await mergePdfFilesActivity({ 
      pdfFilePaths,
      outputPath
    });
    result.reportPath = reportPath;

    if (result.failedJobs > 0) {
      result.status = 'PARTIAL';
      log.warn(`Consolidated report completed with ${result.failedJobs} failed jobs`);
    } else {
      result.status = 'COMPLETED';
      log.info(`Consolidated report completed successfully`);
    }

    await updateConsolidatedReportStatus({ 
      fileServerId, 
      status: result.status,
      reportPath,
      successfulJobs: result.successfulJobs,
      failedJobs: result.failedJobs,
      failedVolumes: result.failedVolumes,
    });
    return result;
  } catch (error) {
    log.error(`Consolidated report workflow failed: ${error.message}`);
    
    if (tempFilePaths.length > 0) {
      try {
        await cleanupTempFilesActivity({ filePaths: tempFilePaths });
        tempFilePaths.length = 0;
      } catch (cleanupError) {
        log.warn(`Failed to cleanup temp files: ${cleanupError.message}`);
      }
    }
    
    result.status = 'FAILED';
    result.errorMessage = error.message;
    
    await updateConsolidatedReportStatus({ 
      fileServerId, 
      status: 'FAILED', 
      errorMessage: error.message 
    });
    
    throw error;
  }
};
