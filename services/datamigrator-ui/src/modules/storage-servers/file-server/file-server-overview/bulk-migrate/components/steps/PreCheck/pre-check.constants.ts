export const PRECHECK_ERROR_STATUS = {
  DESTINATION_PATH_MOUNT_FAILED: "The destination mount path failed.",
  SOURCE_PATH_MOUNT_FAILED: "The source mount path failed.",
  DESTINATION_PATH_WRITE_PERMISSION_FAILED:
    "The destination path does not have write permission.",
  SOURCE_PATH_WRITE_PERMISSION_FAILED:
    "The source path does not have write permission.",
  PROTOCOL_VERSION_MISMATCH: "The protocol version does not match.",
  NO_COMMON_WORKERS: "There are no common workers available.",
  DESTINATION_PATH_NOT_FOUND: "The destination path was not found.",
  SOURCE_PATH_NOT_FOUND: "The source path was not found.",
  SOURCE_DATA_SIZE_CALCULATION_FAILED:
    "The calculation of the source data size failed.",
  SOURCE_PATH_UNMOUNT_FAILED: "The source path failed to unmount.",
  ALL_COMMON_WORKERS_UNHEALTHY: "All common workers are unhealthy.",
  MIGRATION_CONFLICTS_FOUND: "Migration conflicts detected during precheck.",
};
