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
    handleReset,
    showUploadUI,
    showUpgradeUI,
    isProcessing,
    inProgressFileName,
  } = useContext(UpgradeContext);

  const showResetButton =
    uploadProgress.status === "error" ||
    uploadProgress.status === "cancelled" ||
    uploadProgress.status === "uploaded";
  
  // Can show file selector when upload UI is allowed
  const canShowFileSelector = showUploadUI;


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

      {/* File Selection - Only show if allowed */}
      <Show>
        <Show.When isTrue={canShowFileSelector || isUploading}>
          <UploadFileSelector />
        </Show.When>
      </Show>

      {/* Upload Progress */}
      <Show>
        <Show.When isTrue={isUploading || isUploaded || uploadProgress.status === "error"}>
          <UploadProgress />
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

        {/* Upgrade Button - Calls handleUpgrade (DRAFT - controlled by UPGRADE_ENABLED flag in context) */}
        <Show>
          <Show.When isTrue={isUploaded || showUpgradeUI}>
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
            <Button onClick={handleReset} variant="outline">
              {RESET_LABEL}
            </Button>
          </Show.When>
        </Show>
      </Box>

      {/* Upload success info */}
      <Show>
        <Show.When isTrue={isUploaded || showUpgradeUI}>
          <Box className="mt-4 p-3 bg-primary/10 rounded border border-primary/30">
            <p className="text-sm text-gray-800">
              <span className="font-medium">Upload Complete:</span>{" "}
              <code className="font-mono text-gray-900">
                {uploadProgress.fileName}
              </code>
            </p>
            <p className="text-xs text-gray-600 mt-1">
              Bundle is ready for upgrade. Click the Upgrade button to proceed.
            </p>
          </Box>
        </Show.When>
      </Show>
    </Card>
  );
};

export default UpgradeContent;
