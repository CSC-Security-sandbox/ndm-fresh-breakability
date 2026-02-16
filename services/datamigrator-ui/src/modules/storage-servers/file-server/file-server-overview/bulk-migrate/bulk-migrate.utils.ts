import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { FormikErrors, FormikProps } from "formik";
import {
  createPathMappingApiPayload,
  ErrorsValidateMappingStepFormType,
  MappingStepFormikFormType,
  MigrationDetailsTableConfigurationType,
  PreCheckStatusType,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import {
  REVIEW_LIST_COLUMN_DEFS,
  SCHEDULE_OPTIONS,
  TIMESTAMP_VALIDATION,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import { AllFileServerWithVolumesApiType } from "@/types/app.type";
import { notify } from "@components/notification/NotificationWrapper";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

export const downloadBulkMigrationCsv = async (
  mappingStepForm: FormikProps<MappingStepFormikFormType>,
  title?: string,
  fileName?: string
) => {
  try {
    const { values } = mappingStepForm;
    const _mappingStepFormValue =
      values?.migrationDetailsTableConfigurationValue;

    if (_mappingStepFormValue && Array.isArray(_mappingStepFormValue)) {
      const headers = [
        "Source Path",
        "Source Directory",
        "Destination File Server",
        "Destination Path",
        "Destination Directory",
      ];
      const dataToExport = _mappingStepFormValue.map(
        (detail: MigrationDetailsTableConfigurationType) => ({
          "Source Path": detail.sourcePath?.sourcePathName ?? "",
          "Source Directory":
            detail.sourceDirectoryPath && detail.sourceDirectoryPath !== "-"
              ? detail.sourceDirectoryPath
              : "-",
          "Destination File Server":
            detail.destinationFileServerDetails?.destinationFileServerName ?? "-",
          "Destination Path":
            detail.destinationPathDetails?.destinationPathName ?? "-",
          "Destination Directory":
            detail.destinationDirectoryPath &&
            detail.destinationDirectoryPath !== "-"
              ? detail.destinationDirectoryPath
              : "-",
        })
      );

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(fileName || "Mappings");

      worksheet.addRow(headers);
      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "ADD8E6" },
        };
        cell.font = { bold: true };
        cell.alignment = { horizontal: "center" };
      });

      dataToExport.forEach((row) => {
        worksheet.addRow(headers.map((h) => row[h]));
      });

      worksheet.columns.forEach((column, index) => {
        let maxLength = headers[index]?.length ?? 10;
        column?.eachCell({ includeEmpty: true }, (cell) => {
          const cellLength = cell.value ? cell.value.toString().length : 0;
          if (cellLength > maxLength) maxLength = cellLength;
        });
        column.width = Math.min(maxLength + 2, 80);
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      saveAs(blob, `${title || "exported_data"}.xlsx`);
    }
  } catch (error: any) {
    notify.error("Failed to export data.");
    console.error(error);
  }
};

/** Normalize source directory path for comparison: empty or "-" becomes "", trailing slashes removed */
const normalizeSourceDirectoryPath = (path: string | undefined): string => {
  if (path === "-" || path === undefined || path === null) return "";
  return String(path).replace(/\/+$/, "").trim();
};

/**
 * Returns true if current path is a child or parent of existing path (for the same export).
 * Used to prevent overlapping source directory mappings.
 */
export const isSourceDirectoryPathChildOrParent = (
  currentPath: string | undefined,
  existingPath: string | undefined
): boolean => {
  const current = normalizeSourceDirectoryPath(currentPath);
  const existing = normalizeSourceDirectoryPath(existingPath);
  if (current === existing) return true;
  if (existing === "") return true;
  if (current === "") return true;
  return (
    current.startsWith(existing + "/") || existing.startsWith(current + "/")
  );
};

export const validateMappingStepForm = (values: MappingStepFormikFormType) => {
  const errors: ErrorsValidateMappingStepFormType = {};

  // Check if at least one path is selected
  if (
    !values.selectedMountPathsId ||
    values.selectedMountPathsId.length === 0
  ) {
    errors.selectedMountPathsId = "At least one path must be selected";
  }

  // Validate schedule date when scheduling for later
  if (values?.scheduleTime === SCHEDULE_OPTIONS?.SCHEDULE_DATE) {
    if (!values?.scheduledDateTime) {
      errors.scheduledDateTime = TIMESTAMP_VALIDATION?.SCHEDULE_LATER_TIMESTAMP;
    } else {
      const now = dayjs.utc();
      const scheduledDateTime = dayjs.utc(values?.scheduledDateTime);

      // Check if date is in the future
      if (scheduledDateTime.isBefore(now)) {
        errors.scheduledDateTime =
          TIMESTAMP_VALIDATION?.SCHEDULE_FUTURE_TIMESTAMP;
      } else {
        // Check if date is at least 5 minutes from now
        const minimumTime = now.add(5, "minute");
        if (scheduledDateTime.isBefore(minimumTime)) {
          errors.scheduledDateTime =
            TIMESTAMP_VALIDATION?.SCHEDULE_FIVE_MINUTE_AHEAD_TIMESTAMP;
        }
      }
    }
  }

  if (
    values.migrationDetailsTableConfigurationValue &&
    values.migrationDetailsTableConfigurationValue.length > 0
  ) {
    values.migrationDetailsTableConfigurationValue.forEach((item, index) => {
      if (values.selectedMountPathsId.includes(String(item.id))) {
        const itemErrors: FormikErrors<MigrationDetailsTableConfigurationType> =
          {} as FormikErrors<MigrationDetailsTableConfigurationType>;

        // Validate destination file server details
        if (!item.destinationFileServerDetails) {
          itemErrors.destinationFileServerDetails = {
            destinationFileServerName:
              "Destination file server name is required",
            destinationFileServerId: "Destination file server ID is required",
          };
        } else {
          const { destinationFileServerName, destinationFileServerId } =
            item.destinationFileServerDetails;
          itemErrors.destinationFileServerDetails = {};

          if (!destinationFileServerName) {
            itemErrors.destinationFileServerDetails.destinationFileServerName =
              "Destination file server name is required";
          }

          if (!destinationFileServerId) {
            itemErrors.destinationFileServerDetails.destinationFileServerId =
              "Destination file server ID is required";
          }

          // Remove the itemErrors.destinationFileServerDetails object if it's empty
          if (
            Object.keys(itemErrors.destinationFileServerDetails).length === 0
          ) {
            delete itemErrors.destinationFileServerDetails;
          }
        }

        // Validate destination path details
        if (!item.destinationPathDetails) {
          itemErrors.destinationPathDetails = {
            destinationPathName: "Destination path name is required",
            destinationPathId: "Destination path ID is required",
          };
        } else {
          const { destinationPathName, destinationPathId } =
            item.destinationPathDetails;
          itemErrors.destinationPathDetails = {};

          if (!destinationPathName) {
            itemErrors.destinationPathDetails.destinationPathName =
              "Destination path name is required";
          }

          if (!destinationPathId) {
            itemErrors.destinationPathDetails.destinationPathId =
              "Destination path ID is required";
          }

          // Remove the itemErrors.destinationPathDetails object if it's empty
          if (Object.keys(itemErrors.destinationPathDetails).length === 0) {
            delete itemErrors.destinationPathDetails;
          }
        }

        // If there are errors for this item, add them to the errors object
        if (Object.keys(itemErrors).length > 0) {
          errors.migrationDetailsTableConfigurationValue =
            errors.migrationDetailsTableConfigurationValue || [];
          errors.migrationDetailsTableConfigurationValue[index] = itemErrors;
        }
      }
    });
  }

  return errors;
};

// FOR PRE-SELECTION OF TABLE ROWS
export const createSelectedMountPathsObject = (
  selectedMountPathsId: string[]
) => {
  return selectedMountPathsId.reduce((acc, id) => {
    acc[id] = true;
    return acc;
  }, {} as Record<string, boolean>);
};

// FOR 3rd(review) STEP TABLE MAPPING
export const structureDataForReviewList = (
  migrationDetails: MigrationDetailsTableConfigurationType[],
  selectedMountPathsId: string[],
  preCheckStatus: PreCheckStatusType
) => {
  const data: typeof REVIEW_LIST_COLUMN_DEFS = [];
  migrationDetails.forEach((detail) => {
    if (!selectedMountPathsId.includes(String(detail?.id))) return;
    data.push({
      source: {
        path: detail.sourcePath.sourcePathName,
        sourcePathId: detail.sourcePath.sourcePathId,
      },
      sourceDirectoryPath: detail.sourceDirectoryPath ?? "-",
      destination: {
        server: detail.destinationFileServerDetails.destinationFileServerName,
        path: detail.destinationPathDetails.destinationPathName,
        pathId: [detail.destinationPathDetails.destinationPathId],
      },
      destinationDirectoryPath: detail.destinationDirectoryPath ?? "-",
      status: preCheckStatus,
    });
  });

  return data;
};

// FOR API BODY MAPPING STEP
export const createPathMapping = (
  migrationDetails: MigrationDetailsTableConfigurationType[],
  selectedMountPathsId: string[]
) => {
  const data: createPathMappingApiPayload[] = [];

  migrationDetails.forEach((detail) => {
    if (!selectedMountPathsId.includes(String(detail?.id))) return;
    data.push({
      sourcePathId: detail.sourcePath.sourcePathId,
      destinationPathId: [detail.destinationPathDetails.destinationPathId],
      sourceDirectoryPath: detail.sourceDirectoryPath,
      destinationDirectoryPath: detail.destinationDirectoryPath,
    });
  });

  return data;
};

export const getDestinationFileServerIdByName = (
  allFileServers: AllFileServerWithVolumesApiType[],
  destinationFileServerName: string
) => {
  return (
    allFileServers.find(
      (fileServer) => fileServer.configName === destinationFileServerName
    )?.id || ""
  );
};

export const getDestinationPathIdByName = (
  allDestinationPaths: AllFileServerWithVolumesApiType[],
  configName: string,
  protocol: "NFS" | "SMB",
  destinationPathName: string
): string => {
  return (
    allDestinationPaths
      .filter((destination) => destination.configName === configName)
      .flatMap((destination) => destination.fileServers)
      .filter((fileServer) => fileServer.protocol === protocol)
      .flatMap((fileServer) => fileServer.volumes)
      .find((volume) => volume.volumePath === destinationPathName)?.id || ""
  );
};

export const handleDownloadTemplate = async (
  downloadFunction: () => any,
  fileName: string
) => {
  try {
    const blob = await downloadFunction().unwrap();

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();

    URL.revokeObjectURL(link.href);
  } catch (error) {
    const errorMessage =
      error?.data?.message || "Failed to download the template: ";
    console.error(errorMessage);
    notify.error(errorMessage);
  }
};

export const migratePathMapping = (
  migrationDetails: MigrationDetailsTableConfigurationType[],
  selectedMountPathsId: string[]
) => {
  const migrateConfigNames = [];

  migrationDetails.forEach((detail) => {
    if (!selectedMountPathsId.includes(String(detail?.id))) return;

    migrateConfigNames.push({
      sourcePathId: detail.sourcePath.sourcePathId,
      destinationPathId: [detail.destinationPathDetails.destinationPathId],
      sourcePathName: detail.sourcePath.sourcePathName,
      destinationPathName: detail.destinationPathDetails.destinationPathName,
    });
  });

  return migrateConfigNames;
};
