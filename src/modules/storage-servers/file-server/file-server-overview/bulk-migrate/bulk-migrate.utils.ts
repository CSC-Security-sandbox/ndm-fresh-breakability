import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { FormikErrors, FormikProps } from "formik";
import {
  createPathMappingApiPayload,
  ErrorsValidateMappingStepFormType,
  MappingStepFormikFormType,
  MigrationDetailsTableConfigurationType,
} from "./bulk-migrate.interface";
import { REVIEW_LIST_COLUMN_DEFS } from "./bulk-migrate.constant";
import { AllFileServerWithVolumesApiType } from "@/types/app.type";
import { notify } from "@components/notification/NotificationWrapper";

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
      const dataToExport = _mappingStepFormValue.map(
        (detail: MigrationDetailsTableConfigurationType) => {
          return {
            id: detail.id,
            "Source Path Name": detail.sourcePath.sourcePathName,
            "Source File Server": JSON.stringify(
              detail.sourceFileServerDetails
            ),
            "Source Path ID": detail.sourcePath.sourcePathId,
            Protocol: detail.protocol,
            "Destination File Server":
              detail.destinationFileServerDetails?.destinationFileServerName,
            "Destination File Server ID":
              detail.destinationFileServerDetails?.destinationFileServerId,
            "Destination Path":
              detail.destinationPathDetails?.destinationPathName,
            "Destination Path ID":
              detail.destinationPathDetails?.destinationPathId,
            "Discovery Job Count": detail.discoveryJobCount,
            "Migration Job Count": detail.migrationJobCount,
            "Cutover Job Count": detail.cutoverJobCount,
          };
        }
      );

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(fileName || "Sheet 1");

      const headers = Object.keys(dataToExport[0]);
      worksheet.addRow(headers);

      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell, colNumber) => {
        const columnHeader = headers[colNumber - 1];

        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "ADD8E6" },
        };
        cell.font = { bold: true };
        cell.alignment = { horizontal: "center" };

        if (
          columnHeader === "Source File Server" ||
          columnHeader === "Source Path ID" ||
          columnHeader === "Destination File Server ID" ||
          columnHeader === "Destination Path ID"
        ) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFCCCB" },
          };
        }
      });

      dataToExport.forEach((row) => {
        const newRow = worksheet.addRow(Object.values(row));

        newRow.eachCell((cell, colNumber) => {
          const columnHeader = headers[colNumber - 1];
          if (
            columnHeader === "Source File Server" ||
            columnHeader === "Source Path ID" ||
            columnHeader === "Destination File Server ID" ||
            columnHeader === "Destination Path ID"
          ) {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFCCCB" },
            };
          }
        });
      });

      worksheet.columns.forEach((column, index) => {
        const columnHeader = headers[index];
        if (
          columnHeader === "Source File Server" ||
          columnHeader === "Source Path ID" ||
          columnHeader === "Destination File Server ID" ||
          columnHeader === "Destination Path ID"
        ) {
          column.hidden = true;
        }
      });

      worksheet.columns.forEach((column, index) => {
        const columnHeader = headers[index];
        if (
          columnHeader !== "Source File Server" &&
          columnHeader !== "Source Path ID" &&
          columnHeader !== "Destination File Server ID" &&
          columnHeader !== "Destination Path ID"
        ) {
          let maxLength = 0;
          column?.eachCell({ includeEmpty: true }, (cell) => {
            const cellLength = cell.value ? cell.value.toString().length : 0;
            if (cellLength > maxLength) {
              maxLength = cellLength;
            }
          });
          column.width = maxLength + 2;
        }
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

export const validateMappingStepForm = (values: MappingStepFormikFormType) => {
  const errors: ErrorsValidateMappingStepFormType = {};

  // Check if at least one path is selected
  if (
    !values.selectedMountPathsId ||
    values.selectedMountPathsId.length === 0
  ) {
    errors.selectedMountPathsId = "At least one path must be selected";
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
  selectedMountPathsId: string[]
) => {
  const data: typeof REVIEW_LIST_COLUMN_DEFS = [];
  migrationDetails.forEach((detail) => {
    if (!selectedMountPathsId.includes(String(detail?.id))) return;
    data.push({
      source: {
        path: detail.sourcePath.sourcePathName,
      },
      destination: {
        server: detail.destinationFileServerDetails.destinationFileServerName,
        path: detail.destinationPathDetails.destinationPathName,
        pathId: [detail.destinationPathDetails.destinationPathId],
      },
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
  protocol: "NFS" | "SMB",
  destinationPathName: string
): string => {
  return (
    allDestinationPaths
      .flatMap((destination) => destination.fileServers)
      .filter((fileServer) => fileServer.protocol === protocol)
      .flatMap((fileServer) => fileServer.volumes)
      .find((volume) => volume.volumePath === destinationPathName)?.id || ""
  );
};

export const handleDownloadTemplate = async (
  downloadFunction: Function,
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
    console.error("Failed to download the template: ", error);
    notify.error("Failed to downlod the template.");
  }
};
