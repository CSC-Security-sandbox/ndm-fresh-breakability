import { useContext } from "react";
import { Button, ProgressLoader } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { UpgradeContext } from "../context/context";
import { UPLOAD_STATUS_MESSAGES, CANCEL_LABEL } from "../constants/upgrade.constant";

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const UploadProgress = () => {
  const { uploadProgress, handleCancelUpload, isUploading } =
    useContext(UpgradeContext);

  const getStatusMessage = () => {
    const baseMessage = UPLOAD_STATUS_MESSAGES[uploadProgress.status] || "";

    if (uploadProgress.status === "uploading") {
      return `${baseMessage} chunk ${uploadProgress.currentChunk} of ${uploadProgress.totalChunks}...`;
    }

    if (uploadProgress.status === "error" && uploadProgress.error) {
      return `${baseMessage}: ${uploadProgress.error}`;
    }

    return baseMessage;
  };

  const getStatusColor = () => {
    switch (uploadProgress.status) {
      case "uploaded":
        return "text-green-600";
      case "error":
        return "text-red-600";
      case "cancelled":
        return "text-yellow-600";
      default:
        return "text-gray-600";
    }
  };

  return (
    <Box className="mt-6 p-4 bg-gray-50 rounded">
      <p className={`mb-3 font-medium ${getStatusColor()}`}>
        {getStatusMessage()}
      </p>

      {(uploadProgress.status === "uploading" ||
        uploadProgress.status === "uploaded") && (
        <Box className="mb-3">
          <ProgressLoader small percent={uploadProgress.progress} />
        </Box>
      )}

      {uploadProgress.status === "uploading" && (
        <Box className="flex justify-between text-sm text-gray-500 mb-3">
          <span>
            {formatBytes(uploadProgress.uploadedBytes)} /{" "}
            {formatBytes(uploadProgress.totalBytes)}
          </span>
          <span>{uploadProgress.progress}%</span>
        </Box>
      )}

      {isUploading && uploadProgress.status === "uploading" && (
        <Box className="flex justify-end">
          <Button onClick={handleCancelUpload} variant="tertiary">
            {CANCEL_LABEL}
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default UploadProgress;