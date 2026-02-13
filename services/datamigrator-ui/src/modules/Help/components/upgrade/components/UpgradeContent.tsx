import { useContext } from "react";
import { Button, Card } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { Show } from "@components/show/Show";
import { UpgradeContext } from "../context/context";
import UploadFileSelector from "./UploadFileSelector";
import UploadProgress from "./UploadProgress";
import {
  UPLOAD_LABEL,
  UPGRADE_LABEL,
  RESET_LABEL,
  JOB_WARNING_TITLE,
  JOB_WARNING_MESSAGE,
  UPGRADE_STATUS_MESSAGES,
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
    upgradeProgress,
    blockingJobs,
    showJobWarning,
    isUpgrading,
    handleUpgrade,
    closeJobWarning,
    handleReset,
    showUploadUI,
    showUpgradeUI,
    isUploadInProgress,
    inProgressFileName,
  } = useContext(UpgradeContext);

  const showResetButton =
    uploadProgress.status === "error" ||
    uploadProgress.status === "cancelled" ||
    upgradeProgress.status === "success" ||
    upgradeProgress.status === "error";
  
  // Can show file selector only if: showUploadUI is true AND no upload in progress from another session
  const canShowFileSelector = showUploadUI && !isUploadInProgress;


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
    <>
      <Card className="p-6 flex flex-col m-8">
        {/* Upload In Progress Warning (from another session/tab) */}
        <Show>
          <Show.When isTrue={isUploadInProgress && !isUploading}>
            <Box className="mb-4 p-4 bg-yellow-50 border border-yellow-300 rounded">
              <p className="font-medium text-yellow-800">
                Upload In Progress
              </p>
              <p className="text-sm text-yellow-700 mt-1">
                An upload is currently in progress{inProgressFileName ? ` for "${inProgressFileName}"` : ''}.
                Please wait for it to complete before starting a new upload.
              </p>
            </Box>
          </Show.When>
        </Show>

        {/* File Selection - Only show if allowed, hide after upgrade success */}
        <Show>
          <Show.When isTrue={(canShowFileSelector || isUploading) && upgradeProgress.status !== "success"}>
            <UploadFileSelector />
          </Show.When>
        </Show>

        {/* Upload Progress - hide after upgrade success */}
        <Show>
          <Show.When isTrue={(isUploading || isUploaded || uploadProgress.status === "error") && upgradeProgress.status !== "success"}>
            <UploadProgress />
          </Show.When>
        </Show>

        {/* Upgrade Status Message */}
        <Show>
          <Show.When isTrue={upgradeProgress.status !== "idle"}>
            <Box className="mt-4 p-3 rounded bg-gray-50">
              <p
                className={`font-medium ${
                  upgradeProgress.status === "success"
                    ? "text-primary"
                    : upgradeProgress.status === "error" ||
                      upgradeProgress.status === "blocked"
                    ? "text-red-600"
                    : "text-gray-600"
                }`}
              >
                {UPGRADE_STATUS_MESSAGES[upgradeProgress.status]}
                {upgradeProgress.error && `: ${upgradeProgress.error}`}
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

          {/* Upgrade Button */}
          <Show>
            <Show.When isTrue={(isUploaded || showUpgradeUI) && upgradeProgress.status !== "success"}>
              <Button
                onClick={handleUpgrade}
                disabled={isUpgrading}
                isSubmitting={isUpgrading}
              >
                {UPGRADE_LABEL}
              </Button>
            </Show.When>
          </Show>

          {/* Reset Button */}
          <Show>
            <Show.When isTrue={showResetButton}>
              <Button onClick={handleReset}>
                {RESET_LABEL}
              </Button>
            </Show.When>
          </Show>
        </Box>

        {/* File path info after upload */}
        <Show>
          <Show.When isTrue={isUploaded && !!uploadProgress.filePath && upgradeProgress.status !== "success"}>
            <Box className="mt-4 p-3 bg-primary/10 rounded border border-primary/30">
              <p className="text-sm text-gray-800">
                <span className="font-medium">File location on VM:</span>{" "}
                <code className="font-mono text-gray-900">
                  {uploadProgress.filePath}
                </code>
              </p>
              <p className="text-xs text-gray-600 mt-1">
                You can verify with: <code className="font-mono">ls -la {uploadProgress.filePath}</code>
              </p>
            </Box>
          </Show.When>
        </Show>
      </Card>

      {/* Job Warning Modal */}
      {showJobWarning && (
        <Box className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Box className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
            <Box className="p-4 border-b">
              <h2 className="text-lg font-semibold">{JOB_WARNING_TITLE}</h2>
            </Box>
            <Box className="p-4">
              <p className="mb-4">{JOB_WARNING_MESSAGE}</p>
              <Box className="max-h-60 overflow-y-auto">
                {blockingJobs.map((job) => (
                  <Box
                    key={job.jobRunId}
                    className="p-3 mb-2 bg-gray-100 rounded border-l-4 border-yellow-500"
                  >
                    <p className="font-medium">
                      {job.jobType} - {job.sourceFileServerName || "N/A"}
                    </p>
                    <p className="text-sm text-gray-600">
                      Status: <span className="font-medium">{job.status}</span>
                    </p>
                    {job.volumePath && (
                      <p className="text-sm text-gray-500">{job.volumePath}</p>
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
            <Box className="p-4 border-t flex justify-end">
              <Button onClick={closeJobWarning}>OK</Button>
            </Box>
          </Box>
        </Box>
      )}
    </>
  );
};

export default UpgradeContent;