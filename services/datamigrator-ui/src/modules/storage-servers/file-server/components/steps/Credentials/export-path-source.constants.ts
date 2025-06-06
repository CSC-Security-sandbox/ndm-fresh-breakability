import { EXPORT_PATH_SOURCE_ENUM } from "@modules/storage-servers/file-server/components/file-server.constant";

export const RADIO_OPTIONS = [
  { value: EXPORT_PATH_SOURCE_ENUM.SHOW_MOUNT, label: "Auto Discover" },
  { value: EXPORT_PATH_SOURCE_ENUM.MANUAL_UPLOAD, label: "Manual Upload" },
];
