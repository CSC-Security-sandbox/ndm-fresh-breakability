import {
  BlueXpTableRowType,
  ConfigListTypeApiType,
  FILE_SERVER_STATUS_ENUM,
} from "@/types/app.type";
import { Autocomplete, TextField } from "@mui/material";
import { useContext, useMemo } from "react";
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
  const {
    allFileServers,
    mappingStepForm,
    sourceFileServerDetails,
    protocolForm,
  } = useContext(BulkMigrateContext);

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
    mappingStepForm.setFieldValue(
      `migrationDetailsTableConfigurationValue[${rowId}].destinationPathDetails.destinationPathId`,
      ""
    );
    mappingStepForm.setFieldValue(
      `migrationDetailsTableConfigurationValue[${rowId}].destinationPathDetails.destinationPathName`,
      ""
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

  const optionsForDestination = useMemo(() => {
    return allFileServers.filter(
      (row) =>
        row.id !== sourceFileServerDetails.id &&
        row.status === FILE_SERVER_STATUS_ENUM.ACTIVE &&
        row.fileServers.find(
          (r) => r.protocol === protocolForm.formState.protocol.value
        )
    );
  }, [
    protocolForm.formState.protocol.value,
    allFileServers,
    sourceFileServerDetails.id,
  ]);

  return (
    <>
      <Autocomplete
        disabled={
          !mappingStepForm?.values?.selectedMountPathsId?.includes(
            String(row.id)
          )
        }
        options={optionsForDestination}
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
