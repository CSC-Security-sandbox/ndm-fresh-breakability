import { useContext, useRef } from "react";
import { Button } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { UpgradeContext } from "../context/context";
import {
  SELECT_FILE_LABEL,
  CLEAR_FILE_LABEL,
  ACCEPTED_FILE_TYPES,
} from "../constants/upgrade.constant";

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const UpgradeFileSelector = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { selectedFile, handleFileSelect, isUploading, isUploaded } =
    useContext(UpgradeContext);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.match(/\.(tar\.gz|zip)$/)) {
        alert("Please select a .tar.gz or .zip file");
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
        <Button
          onClick={handleClick}
          disabled={isDisabled}
          variant="secondary"
        >
          {SELECT_FILE_LABEL}
        </Button>

        {selectedFile && (
          <>
            <Box className="flex-1 p-3 bg-gray-50 rounded border">
              <p className="font-medium truncate">{selectedFile.name}</p>
              <p className="text-sm text-gray-500">
                {formatBytes(selectedFile.size)}
              </p>
            </Box>
            {!isDisabled && (
              <Button
                onClick={handleClear}
                variant="tertiary"
                size="small"
              >
                {CLEAR_FILE_LABEL}
              </Button>
            )}
          </>
        )}
      </Box>

      {!selectedFile && (
        <p className="text-sm text-gray-500">
          Supported formats: .tar.gz, .zip
        </p>
      )}
    </Box>
  );
};

export default UpgradeFileSelector;