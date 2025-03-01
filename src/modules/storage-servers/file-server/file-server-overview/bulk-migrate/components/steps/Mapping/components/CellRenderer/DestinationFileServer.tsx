import { BlueXpTableRowType, ConfigListTypeApiType } from "@/types/app.type";
import { Autocomplete, TextField, FormHelperText } from "@mui/material";
import { memo, useContext } from "react";
import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { MigrationDetailsTableConfigurationType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import { FormikErrors } from "formik";

const DestinationFileServer = ({
  row,
}: BlueXpTableRowType<
  MigrationDetailsTableConfigurationType,
  MigrationDetailsTableConfigurationType
>) => {
  const rowId = Number(row?.id);
  const { allFileServers, mappingStepForm } = useContext(BulkMigrateContext);

  // UPDATE FORM VALUE
  const handleChange = (event: any, newValue: ConfigListTypeApiType | null) => {
    const selectedId = newValue?.id || "";
    const selectedName = newValue?.configName || "";
    mappingStepForm.setFieldValue(
      `migrationDetailsTableConfigurationValue.${rowId}.destinationFileServerDetails.destinationFileServerId`,
      selectedId
    );
    mappingStepForm.setFieldValue(
      `migrationDetailsTableConfigurationValue.${rowId}.destinationFileServerDetails.destinationFileServerName`,
      selectedName
    );
  };

  const selectedValue =
    allFileServers.find(
      (server) =>
        server.id ===
        mappingStepForm?.values?.migrationDetailsTableConfigurationValue[rowId]
          ?.destinationFileServerDetails?.destinationFileServerId
    ) || null;

  const error = mappingStepForm.errors
    ?.migrationDetailsTableConfigurationValue?.[
    rowId
  ] as FormikErrors<MigrationDetailsTableConfigurationType>;

  return (
    <>
      <Autocomplete
        disabled={
          !mappingStepForm?.values?.selectedMountPathsId?.includes(
            String(row.id)
          )
        }
        options={allFileServers}
        getOptionLabel={(option) => option?.configName || ""}
        className="w-full"
        size="small"
        value={selectedValue}
        isOptionEqualToValue={(option, value) => option.id === value?.id}
        onChange={handleChange}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder="Select..."
            error={!!error?.destinationFileServerDetails}
            helperText={error?.destinationFileServerDetails ? "" : ""}
          />
        )}
        renderOption={(props, option) => (
          <li {...props} key={option?.id}>
            {option?.configName}
          </li>
        )}
      />
    </>
  );
};

export default DestinationFileServer;
