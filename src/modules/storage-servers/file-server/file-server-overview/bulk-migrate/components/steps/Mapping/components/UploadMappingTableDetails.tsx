import Button from "@mui/material/Button";
import { styled } from "@mui/material/styles";
import ExcelJS from "exceljs";
import * as React from "react";
import {
  MappingStepFormikFormType,
  MigrationDetailsTableConfigurationType,
  UploadMappingTableDetailsType,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import {
  getDestinationFileServerIdByName,
  getDestinationPathIdByName,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";

const VisuallyHiddenInput = styled("input")({
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  height: 1,
  overflow: "hidden",
  position: "absolute",
  bottom: 0,
  left: 0,
  whiteSpace: "nowrap",
  width: 1,
});

const UploadMappingTableDetails = ({
  toggleRowSelection,
}: UploadMappingTableDetailsType) => {
  const {
    setMigrationDetailsTableConfiguration,
    mappingStepForm,
    allFileServers,
  } = React.useContext(BulkMigrateContext);

  // UPLOAD
  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (file) {
      try {
        const workbook = new ExcelJS.Workbook();
        const buffer = await file.arrayBuffer();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
          throw new Error("No worksheet found in the Excel file.");
        }

        const headerRow = worksheet.getRow(1);
        const headers = headerRow.values as string[];
        if (!headers || headers.length === 0) {
          throw new Error("No headers found in the worksheet.");
        }

        const parsedData: MigrationDetailsTableConfigurationType[] = [];
        const selectedMountPathsId: string[] = [];

        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;

          const rowData: any = {};

          row.eachCell((cell, colNumber) => {
            const header = headers[colNumber];
            rowData[header] = cell.value;
          });

          if (rowData["Source File Server"]) {
            rowData.sourceFileServerDetails = JSON.parse(
              rowData["Source File Server"]
            );
            delete rowData["Source File Server"]; // Remove the serialized key
          }

          const destinationFileServerId = getDestinationFileServerIdByName(
            allFileServers,
            rowData["Destination"]
          );
          if (destinationFileServerId) {
            toggleRowSelection(rowData.id)(true);
          }

          const destinationPathId = getDestinationPathIdByName(
            allFileServers,
            rowData["Protocol"],
            rowData["Destination Path"]
          );

          const originalObject: MigrationDetailsTableConfigurationType = {
            id: rowData.id, // Use row number as ID (or generate a new one)
            sourceFileServerDetails: rowData.sourceFileServerDetails,
            sourcePath: {
              sourcePathName: rowData["Source Path Name"],
              sourcePathId: rowData["Source Path ID"], // Use the found sourcePathId
              volume: {} as any, // Add volume details if available
            },
            protocol: rowData["Protocol"],
            destinationFileServerDetails: {
              destinationFileServerName: rowData["Destination"],
              destinationFileServerId,
            },
            destinationPathDetails: {
              destinationPathName: rowData["Destination Path"],
              destinationPathId,
            },
            discoveryJobCount: rowData["Discovery Job Count"],
            migrationJobCount: rowData["Migration Job Count"],
            cutoverJobCount: rowData["Cutover Job Count"],
          };

          parsedData.push(originalObject);
        });

        if (parsedData.length !== 0) {
          mappingStepForm.setValues({
            ...mappingStepForm?.values,
            migrationDetailsTableConfigurationValue: parsedData,
            selectedMountPathsId,
          } as MappingStepFormikFormType);
        } else {
          console.error("mappingStepForm is undefined or null");
        }
        setMigrationDetailsTableConfiguration(parsedData);
      } catch (error: any) {
        console.error(
          "#==================Error reading Excel file:",
          error.message
        );
      }
    }
  };

  return (
    <Button
      component="label"
      role={undefined}
      variant="contained"
      tabIndex={-1}
      startIcon={<></>}
    >
      Upload files
      <VisuallyHiddenInput
        type="file"
        onChange={handleFileChange}
        accept=".xlsx, .xls"
        multiple
      />
    </Button>
  );
};

export default UploadMappingTableDetails;
