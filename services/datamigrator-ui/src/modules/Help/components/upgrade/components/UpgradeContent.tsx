import { useContext } from "react";
import { Button, Card } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { Show } from "@components/show/Show";
import { UpgradeContext } from "../context/context";
import UploadFileSelector from "./UploadFileSelector";
import UploadProgress from "./UploadProgress";
import StagingProgress from "./StagingProgress";
import ExecutionProgress from "./ExecutionProgress";
import {
  UPLOAD_LABEL,
  UPGRADE_LABEL,
  RESET_LABEL,
} from "../constants/upgrade.constant";
import userIsAppAdmin from "@/hooks/userIsAppAdmin";


const UpgradeContent = () => {
  const isAppAdmin = userIsAppAdmin();

  const {
    selectedFile,
    uploadProgress,
    isUploading,
    isUploaded,
    handleUpload,
    handleUpgrade,
    isUpgrading,
    blockingJobs,
    handleReset,
    showUploadUI,
    showUpgradeUI,
    isProcessing,
    isUploadInProgress,
    inProgressFileName,
    workerUploadStatus,
    multicastStatus,
    workerUpgradeStatus,
    isUpgradeExecuting,
    executionStatus,
    upgradeStatus,
  } = useContext(UpgradeContext);

  // Determine if worker execution UI should take over
  const showExecutionUI =
    workerUpgradeStatus === 'IN_PROGRESS' ||
    workerUpgradeStatus === 'COMPLETED';

  const showResetButton =
    !isUploading && (  // Hide during upload
      uploadProgress.status === "error" ||
      uploadProgress.status === "cancelled" ||
      uploadProgress.status === "uploaded" ||
      isUploadInProgress ||
      (executionStatus?.upgradeCompleted === true) ||
      (workerUpgradeStatus === 'COMPLETED')
    );
  
  // Can show file selector when upload UI is allowed and not in execution phase
  const canShowFileSelector = showUploadUI && !showExecutionUI;


    if (!isAppAdmin) {
        return (
          <Box className="p-6 text-center">
            <p className="text-red-600 font-medium">Access Denied</p>
            <p className="text-gray-500 mt-2">
              Only App Administrators can upload and apply upgrade bundles.
            </p>
          </Box>
        );
    }

  return (
    <Card className="p-6 flex flex-col m-8">
      {/* Processing In Progress (extraction/validation - DO NOT CANCEL) */}
      <Show>
        <Show.When isTrue={isProcessing && !isUploading}>
          <Box className="mb-4 p-4 bg-blue-50 border border-blue-300 rounded">
            <Box className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              <p className="font-medium text-blue-800">
                Processing Bundle
              </p>
            </Box>
            <p className="text-sm text-blue-700 mt-2">
              {inProgressFileName ? `"${inProgressFileName}" is` : 'A bundle is'} being extracted and validated.
              This may take a few minutes for large bundles. Please do not close this page.
            </p>
          </Box>
        </Show.When>
      </Show>

      {/* Upload Interrupted (pod restart during upload) */}
      <Show>
        <Show.When isTrue={isUploadInProgress && !isUploading && !isProcessing}>
          <Box className="mb-4 p-4 bg-amber-50 border border-amber-300 rounded">
            <p className="font-medium text-amber-800">
              Upload Interrupted
            </p>
            <p className="text-sm text-amber-700 mt-2">
              {inProgressFileName ? `A previous upload of "${inProgressFileName}" was` : 'A previous upload was'} interrupted.
              Click "Start Over" below to clear it and start a new upload.
            </p>
          </Box>
        </Show.When>
      </Show>

      {/* CP Upgrade Failed / Rolled Back */}
      <Show>
        <Show.When isTrue={upgradeStatus === 'rolled_back' || upgradeStatus === 'failed'}>
          <Box className="mb-4 p-4 rounded border" style={{
            backgroundColor: upgradeStatus === 'rolled_back' ? '#fef2f2' : '#fef2f2',
            borderColor: '#fca5a5',
          }}>
            <Box className="flex items-center gap-3">
              <svg className="h-5 w-5" style={{ color: '#dc2626' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" />
              </svg>
              <p className="font-medium" style={{ color: '#991b1b' }}>
                {upgradeStatus === 'rolled_back'
                  ? 'Control Plane Upgrade Failed — Rolled Back'
                  : 'Control Plane Upgrade Failed'}
              </p>
            </Box>
            <p className="text-sm mt-2" style={{ color: '#b91c1c' }}>
              {upgradeStatus === 'rolled_back'
                ? 'The upgrade was unsuccessful and the system has been rolled back to the previous version. Please check the upgrade logs and try again with a new bundle.'
                : 'The upgrade process failed. Please check the upgrade logs and try again with a new bundle.'}
            </p>
          </Box>
        </Show.When>
      </Show>

      {/* File Selection - Only show if allowed */}
      <Show>
        <Show.When isTrue={canShowFileSelector || isUploading}>
          <UploadFileSelector />
        </Show.When>
      </Show>

      {/* Upload Progress — hidden during execution */}
      <Show>
        <Show.When isTrue={(isUploading || isUploaded || uploadProgress.status === "error") && !showExecutionUI}>
          <UploadProgress />
        </Show.When>
      </Show>

      {/* Worker Upgrade Execution Progress */}
      <Show>
        <Show.When isTrue={showExecutionUI}>
          <ExecutionProgress />
        </Show.When>
      </Show>

      {/* Blocking Jobs Warning */}
      <Show>
        <Show.When isTrue={!!blockingJobs && (blockingJobs.runningJobs.length > 0 || blockingJobs.scheduledJobs.length > 0 || blockingJobs.activeJobConfigs.length > 0)}>
          <Box className="mb-4 p-4 bg-red-50 border border-red-300 rounded">
            <p className="font-medium text-red-800 mb-2">
              Cannot upgrade while jobs are active
            </p>
            <p className="text-sm text-red-700 mb-3">
              Please stop all running migrations and deactivate all job configurations before upgrading.
            </p>

            {blockingJobs?.runningJobs && blockingJobs.runningJobs.length > 0 && (
              <Box className="mb-3">
                <p className="text-sm font-medium text-red-800 mb-1">
                  Running Jobs ({blockingJobs.runningJobs.length}):
                </p>
                <Box className="bg-white rounded border border-red-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-red-100 text-red-800">
                        <th className="px-3 py-1.5 text-left font-medium">Job ID</th>
                        <th className="px-3 py-1.5 text-left font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blockingJobs.runningJobs.map((job) => (
                        <tr key={job.id} className="border-t border-red-100">
                          <td className="px-3 py-1.5 font-mono text-xs">{job.id.slice(0, 8)}...</td>
                          <td className="px-3 py-1.5">
                            <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">
                              {job.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              </Box>
            )}

            {blockingJobs?.activeJobConfigs && blockingJobs.activeJobConfigs.length > 0 && (
              <Box className="mb-3">
                <p className="text-sm font-medium text-red-800 mb-1">
                  Active Job Configurations ({blockingJobs.activeJobConfigs.length}):
                </p>
                <Box className="bg-white rounded border border-red-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-red-100 text-red-800">
                        <th className="px-3 py-1.5 text-left font-medium">Job ID</th>
                        <th className="px-3 py-1.5 text-left font-medium">Type</th>
                        <th className="px-3 py-1.5 text-left font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blockingJobs.activeJobConfigs.map((job) => (
                        <tr key={job.id} className="border-t border-red-100">
                          <td className="px-3 py-1.5 font-mono text-xs">{job.id.slice(0, 8)}...</td>
                          <td className="px-3 py-1.5 text-xs">{job.jobType || "—"}</td>
                          <td className="px-3 py-1.5">
                            <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">
                              {job.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              </Box>
            )}

            {blockingJobs?.scheduledJobs && blockingJobs.scheduledJobs.length > 0 && (
              <Box className="mb-1">
                <p className="text-sm font-medium text-red-800 mb-1">
                  Scheduled Jobs ({blockingJobs.scheduledJobs.length}):
                </p>
                <Box className="bg-white rounded border border-red-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-red-100 text-red-800">
                        <th className="px-3 py-1.5 text-left font-medium">Job ID</th>
                        <th className="px-3 py-1.5 text-left font-medium">Type</th>
                        <th className="px-3 py-1.5 text-left font-medium">Schedule</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blockingJobs.scheduledJobs.map((job) => (
                        <tr key={job.id} className="border-t border-red-100">
                          <td className="px-3 py-1.5 font-mono text-xs">{job.id.slice(0, 8)}...</td>
                          <td className="px-3 py-1.5 text-xs">{job.jobType || "—"}</td>
                          <td className="px-3 py-1.5 text-xs">{job.scheduler === "SCHEDULING" ? "Scheduling..." : job.futureScheduleAt || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              </Box>
            )}

            <p className="text-xs text-red-600 mt-2">
              Deactivate all job configurations, then click Upgrade again.
            </p>
          </Box>
        </Show.When>
      </Show>

      {/* Action Buttons */}
      <Box className="flex justify-center gap-4 mt-6">
        {/* Upload Button - Only show if allowed and no in-progress upload */}
        <Show>
          <Show.When isTrue={canShowFileSelector && !isUploaded && !showResetButton}>
            <Button
              onClick={handleUpload}
              disabled={!selectedFile || isUploading}
              isSubmitting={isUploading}
            >
              {UPLOAD_LABEL}
            </Button>
          </Show.When>
        </Show>

        {/* Upgrade Button - Hidden during/after execution, disabled once clicked */}
        <Show>
          <Show.When isTrue={(isUploaded || showUpgradeUI) && workerUploadStatus === 'COMPLETED' && !showExecutionUI}>
            <Button
              onClick={handleUpgrade}
              disabled={isUpgrading || isUpgradeExecuting}
              isSubmitting={isUpgrading}
            >
              {UPGRADE_LABEL}
            </Button>
          </Show.When>
        </Show>

        {/* Reset Button */}
        <Show>
          <Show.When isTrue={showResetButton}>
            <Button onClick={handleReset} variant="outline">
              {RESET_LABEL}
            </Button>
          </Show.When>
        </Show>
      </Box>

      {/* Upload success info — hidden during execution */}
      <Show>
        <Show.When isTrue={(isUploaded || showUpgradeUI) && !showExecutionUI}>
          <Box className="mt-4 p-3 bg-primary/10 rounded border border-primary/30">
            <p className="text-sm text-gray-800">
              <span className="font-medium">Upload Complete:</span>{" "}
              <code className="font-mono text-gray-900">
                {uploadProgress.fileName}
              </code>
            </p>
            <p className="text-xs text-gray-600 mt-1">
              {workerUploadStatus === 'COMPLETED'
                ? (multicastStatus?.summary?.total === 0
                    ? 'No workers attached. Click Upgrade to proceed.'
                    : 'All workers staged. Click Upgrade to proceed.')
                : 'Distributing binaries to workers...'}
            </p>
          </Box>
        </Show.When>
      </Show>

      {/* Worker binary staging progress — hidden during execution and on upload screen */}
      <Show>
        <Show.When isTrue={!showExecutionUI && !canShowFileSelector && (isUploaded || showUpgradeUI)}>
          <StagingProgress />
        </Show.When>
      </Show>
    </Card>
  );
};

export default UpgradeContent;
