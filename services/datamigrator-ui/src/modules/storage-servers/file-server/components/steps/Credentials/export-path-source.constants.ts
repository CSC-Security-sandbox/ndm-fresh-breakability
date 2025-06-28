import { EXPORT_PATH_SOURCE_ENUM } from "@modules/storage-servers/file-server/components/file-server.constant";

export const RADIO_OPTIONS = [
  { value: EXPORT_PATH_SOURCE_ENUM.AUTO_DISCOVER, label: "Auto Discover" },
  { value: EXPORT_PATH_SOURCE_ENUM.MANUAL_UPLOAD, label: "Manual Upload" },
];

export const MANUAL_UPLOAD_INFO =
  "To manually add export paths, complete the file server setup first. Then, go to the File Server Overview page to upload the file containing the required export paths.";

export const EXPORT_PATH_SOURCE_NOTE =
  "Use manual upload if showmount is not supported, such as with GCNV Flex service, or if you prefer to upload the export paths manually.";

export const EXPORT_PATH_FILE_UPLOAD_IN_PROGRESS_TEXT =
  "Export Paths File upload is in progress...";

export const NO_DATA_TEXT = "No Data";

export const VALIDATION_STATUS = {
  VALID: "Valid",
  INVALID: "Invalid",
};

export const PROTOCOLS = {
  NFS: "NFS",
  SMB: "SMB",
};
