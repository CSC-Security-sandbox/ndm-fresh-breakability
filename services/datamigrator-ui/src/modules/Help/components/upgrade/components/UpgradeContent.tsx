import { useContext } from "react";
import { Card } from "@netapp/bxp-design-system-react";
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
    handleStopAllJobs,
    isStoppingJobs,
    handleReset,
    showUploadUI,
    showUpgradeUI,
    isProcessing,
    isUploadInProgress,
    inProgressFileName,
    workerUploadStatus,
    multicastStatus,
    workerUpgradeStatus,
    deactivatedConfigIds,
    stoppedRunIds,
    handleDownloadReport,
    isDownloadingReport,
    isUpgradeExecuting,
    executionStatus,
    upgradeStatus,
  } = useContext(UpgradeContext);

  // Determine if worker execution UI should take over
  const showExecutionUI =
    workerUpgradeStatus === 'IN_PROGRESS' ||
    workerUpgradeStatus === 'COMPLETED';

  // When upgrade has failed/rolled back, hide all mid-flow UI — show only the error banner + Start Over.
  // Auto-clears once a new upload begins so the failure banner doesn't linger during re-upload.
  const isUpgradeFailed =
    (upgradeStatus === 'failed' || upgradeStatus === 'rolled_back') && !isUploading;

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
          <Box className="mb-4 p-4 bg-white border-l-4 border border-gray-200 rounded" style={{ borderLeftColor: "#3b82f6" }}>
            <Box className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              <p className="font-medium text-blue-800">
                Processing Bundle
              </p>
            </Box>
            <p className="text-sm text-gray-600 mt-2">
              {inProgressFileName ? `"${inProgressFileName}" is` : 'A bundle is'} being extracted and validated.
              This may take a few minutes for large bundles. Please do not close this page.
            </p>
          </Box>
        </Show.When>
      </Show>

      {/* Upload Interrupted (pod restart during upload) */}
      <Show>
        <Show.When isTrue={isUploadInProgress && !isUploading && !isProcessing}>
          <Box className="mb-4 p-4 bg-white border-l-4 border border-gray-200 rounded" style={{ borderLeftColor: "#d97706" }}>
            <p className="font-medium text-amber-800">
              Upload Interrupted
            </p>
            <p className="text-sm text-gray-600 mt-2">
              {inProgressFileName ? `A previous upload of "${inProgressFileName}" was` : 'A previous upload was'} interrupted.
              Click "Start Over" below to clear it and start a new upload.
            </p>
          </Box>
        </Show.When>
      </Show>

      {/* CP Upgrade Failed / Rolled Back */}
      <Show>
        <Show.When isTrue={isUpgradeFailed}>
          <Box className="mb-4 p-4 rounded border-l-4 border border-gray-200" style={{
            backgroundColor: "white",
            borderLeftColor: '#dc2626',
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
            <p className="text-sm mt-2 text-gray-600">
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
        <Show.When isTrue={(isUploading || isUploaded || uploadProgress.status === "error") && !showExecutionUI && !isUpgradeFailed}>
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
        <Show.When isTrue={!isUpgradeFailed && !!blockingJobs && (blockingJobs.runningJobs.length > 0 || blockingJobs.scheduledJobs.length > 0 || blockingJobs.activeJobConfigs.length > 0)}>
          <Box className="mb-4 p-4 bg-white border-l-4 border border-gray-200 rounded" style={{ borderLeftColor: "#dc2626" }}>
            <p className="font-medium text-red-800 mb-2">
              Cannot upgrade while jobs are active
            </p>
            <p className="text-sm text-gray-600 mb-3">
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

            {/* Stop All Jobs action button */}
            <Box className="flex justify-end mt-3 pt-3 border-t border-red-200">
              <button
                onClick={handleStopAllJobs}
                disabled={isStoppingJobs}
                style={{
                  padding: "8px 20px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: isStoppingJobs ? "#e0e0e0" : "#dc2626",
                  color: isStoppingJobs ? "#A7A7A7" : "white",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: isStoppingJobs ? "not-allowed" : "pointer",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                  transition: "background-color 0.15s ease",
                }}
                onMouseEnter={(e) => { if (!isStoppingJobs) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#991b1b"; }}
                onMouseLeave={(e) => { if (!isStoppingJobs) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#dc2626"; }}
              >
                {isStoppingJobs ? 'Stopping All Jobs...' : 'Stop All Jobs & Deactivate'}
              </button>
            </Box>
          </Box>
        </Show.When>
      </Show>

      {/* Download Report Panel — shown once jobs have been stopped */}
      <Show>
        <Show.When isTrue={!isUpgradeFailed && !showExecutionUI && (deactivatedConfigIds?.length > 0 || stoppedRunIds?.length > 0) && !blockingJobs}>
          <Box className="mb-4 p-4 bg-white border-l-4 border border-gray-200 rounded" style={{ borderLeftColor: "#3b82f6" }}>
            <p className="font-medium text-blue-800 mb-1">Jobs Stopped</p>
            <p className="text-sm text-gray-600 mb-3">
              {stoppedRunIds?.length ?? 0} job run(s) stopped &amp; {deactivatedConfigIds?.length ?? 0} job config(s) deactivated before upgrade.
              Download the report for your records.
            </p>
            <Box className="flex justify-end">
              <button
                onClick={handleDownloadReport}
                disabled={isDownloadingReport}
                style={{
                  padding: "8px 18px",
                  borderRadius: "8px",
                  border: "1px solid #A7A7A7",
                  backgroundColor: "white",
                  color: isDownloadingReport ? "#A7A7A7" : "#404040",
                  fontSize: "14px",
                  fontWeight: 500,
                  cursor: isDownloadingReport ? "not-allowed" : "pointer",
                  opacity: isDownloadingReport ? 0.6 : 1,
                  boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                  transition: "background-color 0.15s ease",
                }}
                onMouseEnter={(e) => { if (!isDownloadingReport) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#f5f5f5"; }}
                onMouseLeave={(e) => { if (!isDownloadingReport) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "white"; }}
              >
                {isDownloadingReport ? 'Generating...' : 'Download Report (CSV)'}
              </button>
            </Box>
          </Box>
        </Show.When>
      </Show>

      {/* Action Buttons */}
      <Box className="flex justify-center gap-4 mt-6">
        {/* Upload Button - Only show if allowed and no in-progress upload */}
        <Show>
          <Show.When isTrue={canShowFileSelector && !isUploaded && !showResetButton}>
            {(() => {
              const isDisabled = !selectedFile || isUploading;
              return (
                <button
                  onClick={handleUpload}
                  disabled={isDisabled}
                  style={{
                    padding: "8px 20px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: isDisabled ? "#e0e0e0" : "#0067C5",
                    color: isDisabled ? "#A7A7A7" : "white",
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: isDisabled ? "not-allowed" : "pointer",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                    transition: "background-color 0.15s ease",
                  }}
                  onMouseEnter={(e) => { if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1E4A93"; }}
                  onMouseLeave={(e) => { if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#0067C5"; }}
                >
                  {isUploading ? 'Uploading...' : UPLOAD_LABEL}
                </button>
              );
            })()}
          </Show.When>
        </Show>

        {/* Upgrade Button - Hidden during/after execution, disabled once clicked */}
        <Show>
          <Show.When isTrue={(isUploaded || showUpgradeUI) && workerUploadStatus === 'COMPLETED' && !showExecutionUI && !isUpgradeFailed}>
            {(() => {
              const isDisabled = isUpgrading || isUpgradeExecuting;
              return (
                <button
                  onClick={handleUpgrade}
                  disabled={isDisabled}
                  style={{
                    padding: "8px 20px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: isDisabled ? "#e0e0e0" : "#0067C5",
                    color: isDisabled ? "#A7A7A7" : "white",
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: isDisabled ? "not-allowed" : "pointer",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                    transition: "background-color 0.15s ease",
                  }}
                  onMouseEnter={(e) => { if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1E4A93"; }}
                  onMouseLeave={(e) => { if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#0067C5"; }}
                >
                  {isUpgrading ? 'Upgrading...' : UPGRADE_LABEL}
                </button>
              );
            })()}
          </Show.When>
        </Show>

        {/* Reset Button */}
        <Show>
          <Show.When isTrue={showResetButton}>
            <button
              onClick={handleReset}
              style={{
                padding: "8px 20px",
                borderRadius: "8px",
                border: "1px solid #A7A7A7",
                backgroundColor: "white",
                color: "#404040",
                fontSize: "14px",
                fontWeight: 500,
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                transition: "background-color 0.15s ease",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#f5f5f5"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "white"; }}
            >
              {RESET_LABEL}
            </button>
          </Show.When>
        </Show>
      </Box>

      {/* Upload success info — hidden during execution */}
      <Show>
        <Show.When isTrue={(isUploaded || showUpgradeUI) && !showExecutionUI && !isUpgradeFailed}>
          <Box className="mt-4 p-3 bg-white rounded border-l-4 border border-gray-200" style={{ borderLeftColor: "#6366f1" }}>
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
        <Show.When isTrue={!showExecutionUI && !canShowFileSelector && (isUploaded || showUpgradeUI) && !isUpgradeFailed}>
          <StagingProgress />
        </Show.When>
      </Show>
    </Card>
  );
};

export default UpgradeContent;
