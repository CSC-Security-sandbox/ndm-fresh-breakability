import {
  AllFileServerWithVolumesApiType,
  BlueXpTableRowType,
  FILE_SERVER_STATUS_ENUM,
} from "@/types/app.type";
import { Autocomplete, TextField } from "@mui/material";
import { useContext, useMemo } from "react";
import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { MigrationDetailsTableConfigurationType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import { FormikErrors } from "formik";

// Type for flattened destination options that includes zone-level selections
interface DestinationOption {
  // For Dell Isilon zones, this is the fileServer (zone) ID; for OtherNAS, it's the config ID
  id: string;
  // Display name: "ConfigName: ZoneName" for Dell Isilon, "ConfigName" for OtherNAS
  displayName: string;
  // The parent config ID (for looking up paths in fileServerWithPathsMap)
  configId: string;
  // The fileServer ID (zone) for Dell Isilon, same as configId for OtherNAS
  fileServerId: string;
  // Config type to differentiate Dell Isilon from OtherNAS
  configType?: string;
}

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

  // Build flattened destination options that show zones for Dell Isilon
  const optionsForDestination = useMemo(() => {
    const options: DestinationOption[] = [];
    const selectedProtocol = protocolForm.formState.protocol.value;

    allFileServers.forEach((config: AllFileServerWithVolumesApiType) => {
      // Skip source config
      if (config.id === sourceFileServerDetails.id) {
        return;
      }

      // Check if it's OtherNAS - only OtherNAS shows just config name
      const isOtherNas = config.configType === "OtherNAS";

      if (!isOtherNas) {
        // For Dell Isilon (or other multi-zone configs): add each zone as a separate option, check zone-level status
        config.fileServers.forEach((fileServer) => {
          // Check zone status (fileServer.status) instead of config status
          const isZoneActive = fileServer.status === FILE_SERVER_STATUS_ENUM.ACTIVE;
          if (fileServer.protocol === selectedProtocol && isZoneActive) {
            options.push({
              id: fileServer.id,
              displayName: fileServer.fileServerName
                ? `${config.configName}: ${fileServer.fileServerName}`
                : config.configName,
              configId: config.id,
              fileServerId: fileServer.id,
              configType: config.configType,
            });
          }
        });
      } else {
        // For OtherNAS: check config-level status
        if (config.status !== FILE_SERVER_STATUS_ENUM.ACTIVE) {
          return;
        }
        const hasMatchingProtocol = config.fileServers.some(
          (fs) => fs.protocol === selectedProtocol
        );
        if (hasMatchingProtocol) {
          options.push({
            id: config.id,
            displayName: config.configName,
            configId: config.id,
            fileServerId: config.id,
            configType: config.configType,
          });
        }
      }
    });

    return options;
  }, [
    protocolForm.formState.protocol.value,
    allFileServers,
    sourceFileServerDetails.id,
  ]);

  // UPDATE FORM VALUE
  const handleChange = (event: any, newValue: DestinationOption | null) => {
    const selectedId = newValue?.fileServerId || "";
    const selectedName = newValue?.displayName || "";
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
    optionsForDestination.find(
      (option) =>
        option.fileServerId ===
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
        options={optionsForDestination}
        getOptionLabel={(option) => option?.displayName || ""}
        className="w-full"
        size="small"
        value={selectedValue}
        isOptionEqualToValue={(option, value) =>
          option.fileServerId === value?.fileServerId
        }
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
            {option?.displayName}
          </li>
        )}
      />
    </>
  );
};

export default DestinationFileServer;
