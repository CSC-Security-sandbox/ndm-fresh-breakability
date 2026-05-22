import { ProtocolType } from "@/types/app.type";
import { useLazyDownloadTemplateQuery } from "@api/jobsApi";
import { Box } from "@components/container/index";
import FormFrame from "@modules/storage-servers/file-server/components/layout/FormFrame";
import { SKIP_FILE_OPTIONS } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import {
  SMB_CONVERT_INHERITED_PERMISSIONS_LABEL,
  isConvertInheritedPermissionsEnabled,
  toConvertInheritedPermissionsMode,
} from "@/utils/smb-inheritance.utils";
import {
  handleDownloadTemplate,
  hasDirectoryLevelMappingForProtocol,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";
import IncrementalSyncSchedule from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/IncrementalSyncSchedule/IncrementalSyncSchedule";
import MigrateFileOption from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/MigrateFileOption/MigrateFileOption";
import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import {
  Button,
  FormFieldInputNew,
  FormFieldSelect,
  FormFieldTextArea,
  FormFieldUploadFile,
  Popover,
  Text,
  Toggle,
} from "@netapp/bxp-design-system-react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { useContext } from "react";
dayjs.extend(utc);

const Options = () => {
  const { optionForm, protocolForm, mappingStepForm } =
    useContext(BulkMigrateContext);
  const [downloadTemplateApi] = useLazyDownloadTemplateQuery();

  const hasDirectoryLevelMapping = hasDirectoryLevelMappingForProtocol(
    mappingStepForm.values.migrationDetailsTableConfigurationValue,
    protocolForm.formState.protocol.value
  );

  const showSmbInheritanceMode =
    protocolForm.formState.protocol.value === ProtocolType.SMB &&
    hasDirectoryLevelMapping &&
    optionForm.formState.preserve_permissions;

  return (
    <FormFrame>
      <Box className="p-6 flex">
        <Box className="w-3/6 flex flex-col gap-10">
          <Box className="flex gap-6 items-center">
            <Box className="flex gap-2 items-center">
              <Toggle name="preserve_a_time" form={optionForm}>
                Preserve a-time
              </Toggle>
              <Popover placement="right" verticalPlacement="center">
                In order to preserve access time, toggle it on.
              </Popover>
            </Box>
            <Box className="flex gap-2 items-center">
              <Toggle name="preserve_permissions" form={optionForm}>
                Preserve Permissions
              </Toggle>
              <Popover placement="right" verticalPlacement="center">
                Preserve file and directory source permissions (on destination)
              </Popover>
            </Box>
          </Box>
          {showSmbInheritanceMode && (
            <Box className="flex gap-2 items-center">
              <Toggle
                value={isConvertInheritedPermissionsEnabled(
                  optionForm.formState.smb_permission_inheritance_mode
                )}
                toggle={(enabled) =>
                  optionForm.wrappedHandleFormChange(
                    "smb_permission_inheritance_mode"
                  )(toConvertInheritedPermissionsMode(enabled), null)
                }
              >
                {SMB_CONVERT_INHERITED_PERMISSIONS_LABEL}
              </Toggle>
              <Popover placement="right" verticalPlacement="center">
                When enabled, inherited source permissions are written as
                explicit permissions on the destination for directory-level SMB
                migrations.
              </Popover>
            </Box>
          )}
          <MigrateFileOption />
          <Box className="w-5/6 flex flex-col gap-1">
            <Box className="flex gap-2 items-center mb-1">
              <Text>Skip Files modified in last</Text>
              <Popover placement="right" verticalPlacement="center">
                Skip Files that are recently modified to avoid the need to
                migrate multiple times. These will be migrated during cutover.
              </Popover>
            </Box>
            <Box className="flex gap-2">
              <FormFieldInputNew
                form={optionForm}
                name="skipFileNum"
                placeholder="Number e.g. 10"
                className="!mb-0"
              />
              <Box className="w-52">
                <FormFieldSelect
                  name="skipFileOption"
                  form={optionForm}
                  options={SKIP_FILE_OPTIONS}
                  className="!mb-0"
                />
              </Box>
            </Box>
          </Box>
          <IncrementalSyncSchedule variant="normal_run"/>
        </Box>
        <Box className="w-3/6 flex flex-col gap-10">
          <FormFieldTextArea
            form={optionForm}
            placeholder="Excluded Path Patterns"
            name="exclude_file_patterns"
            label="Excluded Path Patterns"
            isOptional
            labelChildren={
              <Popover>Mention File Patterns that should be excluded</Popover>
            }
          />

          {protocolForm.formState.protocol.value === ProtocolType.NFS ? (
            <FormFieldUploadFile
              form={optionForm}
              label="Upload GID / UID Mapping"
              name="upload_uid_mapping"
              placeholder="Choose a file"
              className="!mb-0"
              disabled={!optionForm.formState.preserve_permissions}
              labelChildren={
                <Box className="flex gap-1 items-center">
                  <Button
                    variant="text"
                    onClick={() =>
                      handleDownloadTemplate(
                        () => downloadTemplateApi("gid"),
                        "gid-template.csv"
                      )
                    }
                    disabled={!optionForm.formState.preserve_permissions}
                  >
                    Download Template
                  </Button>
                  <Popover>
                    {optionForm.formState.preserve_permissions
                      ? "Download/Upload GID & UID Mapping"
                      : "Enable 'Preserve Permissions' to upload GID/UID Mapping"}
                  </Popover>
                </Box>
              }
              errorMessage={
                optionForm?.formErrors?.["upload_uid_mapping.fileName"] ||
                optionForm?.formErrors?.["upload_uid_mapping.contents"]
              }
              showError={
                !!(
                  optionForm?.formErrors?.["upload_uid_mapping.fileName"] ||
                  optionForm?.formErrors?.["upload_uid_mapping.contents"]
                )
              }
            />
          ) : (
            <FormFieldUploadFile
              form={optionForm}
              label="Upload SID Mapping"
              name="upload_sid_mapping"
              placeholder="Choose a file"
              className="!mb-0"
              disabled={!optionForm.formState.preserve_permissions}
              labelChildren={
                <Box className="flex gap-1 items-center">
                  <Button
                    variant="text"
                    onClick={() =>
                      handleDownloadTemplate(
                        () => downloadTemplateApi("sid"),
                        "sid-template.csv"
                      )
                    }
                    disabled={!optionForm.formState.preserve_permissions}
                  >
                    Download Template
                  </Button>
                  <Popover>
                    {optionForm.formState.preserve_permissions
                      ? "Download/Upload SID Mapping"
                      : "Enable 'Preserve Permissions' to upload SID Mapping"}
                  </Popover>
                </Box>
              }
              errorMessage={
                optionForm?.formErrors?.["upload_sid_mapping.fileName"]
              }
              showError={
                optionForm?.formErrors?.["upload_sid_mapping.fileName"] ?? false
              }
            />
          )}
        </Box>
      </Box>
    </FormFrame>
  );
};

export default Options;
