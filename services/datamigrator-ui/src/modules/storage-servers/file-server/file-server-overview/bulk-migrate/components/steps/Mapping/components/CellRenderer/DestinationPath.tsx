import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { BlueXpTableRowType } from "@/types/app.type";
import { Autocomplete, TextField } from "@mui/material";
import { useContext } from "react";
import {
  DestinationPathsOptionsType,
  MigrationDetailsTableConfigurationType,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import { Tooltip } from "@netapp/bxp-design-system-react";

const DestinationFileServer = ({
  row,
}: BlueXpTableRowType<
  MigrationDetailsTableConfigurationType,
  MigrationDetailsTableConfigurationType
>) => {
  const rowId = Number(row?.id);
  const { fileServerWithPathsMap, mappingStepForm } =
    useContext(BulkMigrateContext);

  // Get the selected file server ID based on the current row
  const selectedFileServerId: string =
    mappingStepForm?.values?.migrationDetailsTableConfigurationValue[rowId]
      ?.destinationFileServerDetails?.destinationFileServerId;

  // UPDATE FORM VALUE
  const handleChange = (
    event: any,
    newValue: DestinationPathsOptionsType | null
  ) => {
    mappingStepForm.setFieldValue(
      `migrationDetailsTableConfigurationValue[${rowId}].destinationPathDetails.destinationPathId`,
      newValue?.pathId || ""
    );
    mappingStepForm.setFieldValue(
      `migrationDetailsTableConfigurationValue[${rowId}].destinationPathDetails.destinationPathName`,
      newValue?.pathName || ""
    );
  };

  // Get options based on the selected file server ID
  const options = fileServerWithPathsMap.get(selectedFileServerId) || [];
  const error =
    mappingStepForm.errors?.migrationDetailsTableConfigurationValue?.[rowId];

  // DISABLE IF PATH IS ALREADY SELECTED IN OTHER ROWS
  const isPathAlreadySelected = (pathId: string) => {
    return mappingStepForm?.values?.migrationDetailsTableConfigurationValue?.some(
      (config, index) =>
        index !== rowId && // Exclude current row
        config?.destinationPathDetails?.destinationPathId === pathId &&
        mappingStepForm?.values?.selectedMountPathsId?.includes(
          String(config.id)
        ) // Only check selected rows
    );
  };

  return (
    <Autocomplete
      options={options}
      disabled={
        !mappingStepForm?.values?.selectedMountPathsId?.includes(String(row.id))
      }
      getOptionLabel={(option) => option?.pathName || ""}
      getOptionDisabled={(option) =>
        option?.isDisabled ||
        !option?.isValid ||
        option?.reachableCount === 0 ||
        isPathAlreadySelected(option?.pathId)
      }
      className="w-full"
      size="small"
      value={
        options.find(
          (server) =>
            server?.pathId ===
            mappingStepForm?.values?.migrationDetailsTableConfigurationValue[
              rowId
            ]?.destinationPathDetails?.destinationPathId
        ) || null
      }
      onChange={handleChange}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Select..."
          error={!!error}
          helperText={error ? "" : ""}
        />
      )}
      renderOption={(props, option) =>
        row?.protocol === option.protocol ? (
          <li {...props} key={option?.pathId}>
            <Tooltip nowrap>{option?.pathName}</Tooltip>
            {option?.pathName}
          </li>
        ) : null
      }
    />
  );
};

export default DestinationFileServer;
