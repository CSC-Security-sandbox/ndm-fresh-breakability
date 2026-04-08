import { useContext, useRef } from "react";
import { Box } from "@components/container";
import { UpgradeContext } from "../context/context";
import {
  SELECT_FILE_LABEL,
  CLEAR_FILE_LABEL,
  ACCEPTED_FILE_TYPES,
} from "../constants/upgrade.constant";
import { notify } from "@components/notification/NotificationWrapper";

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const UploadFileSelector = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { selectedFile, handleFileSelect, isUploading, isUploaded } =
    useContext(UpgradeContext);

  const handleClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    fileInputRef.current?.click();
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (file) {
      // Only allow .tar.gz files
      if (!file.name.toLowerCase().endsWith('.tar.gz')) {
        notify.error("Please select a .tar.gz file");
        return;
      }
      handleFileSelect(file);
    }
  };

  const handleClear = () => {
    handleFileSelect(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Disable file selection once uploaded
  const isDisabled = isUploading || isUploaded;

  return (
    <Box className="flex flex-col gap-4">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        onChange={handleChange}
        style={{ display: "none" }}
      />

      <Box className="flex items-center gap-4">
        {/* Show Select File button only when no file is selected */}
        {!selectedFile && (
          <button
            onClick={handleClick}
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
            {SELECT_FILE_LABEL}
          </button>
        )}

        {/* Show file info and Clear button when file is selected */}
        {selectedFile && (
          <>
            <Box className="flex-1 p-3 bg-gray-50 rounded border">
              <p className="font-medium truncate">{selectedFile.name}</p>
              <p className="text-sm text-gray-500">
                {formatBytes(selectedFile.size)}
              </p>
            </Box>
            {!isDisabled && (
              <button
                onClick={handleClear}
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
                {CLEAR_FILE_LABEL}
              </button>
            )}
          </>
        )}
      </Box>

      {!selectedFile && (
        <p className="text-sm text-gray-500">
          Supported format: .tar.gz (e.g., upgrade-v2.1.0.tar.gz)
        </p>
      )}
    </Box>
  );
};

export default UploadFileSelector;
