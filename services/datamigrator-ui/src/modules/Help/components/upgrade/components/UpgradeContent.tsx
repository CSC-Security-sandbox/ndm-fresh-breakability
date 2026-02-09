import { useContext } from "react";
import { Button, Card, Modal } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { Show } from "@components/show/Show";
import { UpgradeContext } from "../context/context";
import UpgradeFileSelector from "./UpgradeFileSelector";
import UpgradeProgress from "./UpgradeProgress";
import {
  UPLOAD_LABEL,
  UPGRADE_LABEL,
  RESET_LABEL,
  JOB_WARNING_TITLE,
  JOB_WARNING_MESSAGE,
  UPGRADE_STATUS_MESSAGES,
} from "../constants/upgrade.constant";

const UpgradeContent = () => {
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
  } = useContext(UpgradeContext);

  const showResetButton =
    uploadProgress.status === "error" ||
    uploadProgress.status === "cancelled" ||
    upgradeProgress.status === "success" ||
    upgradeProgress.status === "error";

  return (
    <>
      <Card className="p-6 flex flex-col m-8">
        {/* File Selection */}
        <UpgradeFileSelector />

        {/* Upload Progress */}
        <Show>
          <Show.When isTrue={isUploading || isUploaded || uploadProgress.status === "error"}>
            <UpgradeProgress />
          </Show.When>
        </Show>

        {/* Upgrade Status Message */}
        <Show>
          <Show.When isTrue={upgradeProgress.status !== "idle"}>
            <Box className="mt-4 p-3 rounded bg-gray-50">
              <p
                className={`font-medium ${
                  upgradeProgress.status === "success"
                    ? "text-green-600"
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
          {/* Upload Button */}
          <Show>
            <Show.When isTrue={!isUploaded && !showResetButton}>
              <Button
                onClick={handleUpload}
                disabled={!selectedFile || isUploading}
                isSubmitting={isUploading}
                variant="secondary"
              >
                {UPLOAD_LABEL}
              </Button>
            </Show.When>
          </Show>

          {/* Upgrade Button */}
          <Show>
            <Show.When isTrue={isUploaded && upgradeProgress.status !== "success"}>
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
              <Button onClick={handleReset} variant="tertiary">
                {RESET_LABEL}
              </Button>
            </Show.When>
          </Show>
        </Box>

        {/* File path info after upload */}
        <Show>
          <Show.When isTrue={isUploaded && uploadProgress.filePath}>
            <Box className="mt-4 p-3 bg-green-50 rounded border border-green-200">
              <p className="text-sm text-green-800">
                <span className="font-medium">File location on VM:</span>{" "}
                <code className="bg-green-100 px-1 rounded">
                  {uploadProgress.filePath}
                </code>
              </p>
              <p className="text-xs text-green-600 mt-1">
                You can verify with: <code>ls -la {uploadProgress.filePath}</code>
              </p>
            </Box>
          </Show.When>
        </Show>
      </Card>

      {/* Job Warning Modal */}
      <Modal
        isOpen={showJobWarning}
        onClose={closeJobWarning}
        title={JOB_WARNING_TITLE}
      >
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
          <Box className="flex justify-end mt-4">
            <Button onClick={closeJobWarning}>OK</Button>
          </Box>
        </Box>
      </Modal>
    </>
  );
};

export default UpgradeContent;