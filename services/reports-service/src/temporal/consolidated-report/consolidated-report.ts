import { proxyActivities, log } from '@temporalio/workflow';
import { ActivitiesService } from 'src/activities/activities.service';

const { 
  getDiscoveryJobsForFileServer,
  generatePdfForJobRun,
  generateCsvForJobRun,
  mergePdfFilesActivity,
  mergeCsvFilesActivity,
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
  format?: 'pdf' | 'csv';
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
  format = 'pdf',
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

    const outputPath = await getConsolidatedReportPathActivity({ 
      fileServerId, 
      configName,
      format,
    });

    if (format === 'csv') {
      const csvFilePaths: string[] = [];
      const csvResults = await Promise.all(
        discoveryJobs.map(async (job) => {
          try {
            log.info(`Generating CSV for jobRunId: ${job.jobRunId}, volumePath: ${job.volumePath}`);
            const csvFilePath = await generateCsvForJobRun({ 
              jobRunId: job.jobRunId, 
              volumePath: job.volumePath 
            });
            if (csvFilePath) {
              log.info(`Successfully generated CSV for jobRunId: ${job.jobRunId}`);
              return { success: true, csvFilePath, volumePath: job.volumePath };
            } else {
              log.warn(`No CSV generated for jobRunId: ${job.jobRunId}`);
              return { success: false, volumePath: job.volumePath };
            }
          } catch (error) {
            log.error(`Failed to generate CSV for jobRunId: ${job.jobRunId}: ${error.message}`);
            return { success: false, volumePath: job.volumePath, error: error.message };
          }
        })
      );

      csvResults.forEach((r) => {
        if (r.success) {
          csvFilePaths.push(r.csvFilePath);
          tempFilePaths.push(r.csvFilePath);
          result.successfulJobs++;
        } else {
          result.failedJobs++;
          result.failedVolumes.push(r.volumePath);
        }
      });

      if (csvFilePaths.length === 0) {
        result.status = 'FAILED';
        result.errorMessage = `All discovery job CSVs failed to generate. Failed volumes: ${result.failedVolumes.join(', ')}`;
        await updateConsolidatedReportStatus({ 
          fileServerId, 
          status: 'FAILED', 
          errorMessage: result.errorMessage,
        });
        return result;
      }

      log.info(`Merging ${csvFilePaths.length} CSVs to ${outputPath}`);
      const reportPath = await mergeCsvFilesActivity({ csvFilePaths, outputPath });
      result.reportPath = reportPath;
    } else {
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

      log.info(`Merging ${pdfFilePaths.length} PDFs to ${outputPath}`);
      const reportPath = await mergePdfFilesActivity({ pdfFilePaths, outputPath });
      result.reportPath = reportPath;
    }

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
      reportPath: result.reportPath,
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
