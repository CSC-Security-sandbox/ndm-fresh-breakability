import { ProtocolType } from "@/types/app.type";
import { useLazyDownloadTemplateQuery } from "@api/jobsApi";
import { Box } from "@components/container/index";
import FormFrame from "@modules/storage-servers/file-server/components/layout/FormFrame";
import { SKIP_FILE_OPTIONS } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import { handleDownloadTemplate } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";
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
  const { optionForm, protocolForm } = useContext(BulkMigrateContext);
  const [downloadTemplateApi] = useLazyDownloadTemplateQuery();

  return (
    <FormFrame>
      <Box className="p-6 flex">
        <Box className="w-3/6 flex flex-col gap-10">
          <Box className="flex gap-1 items-center">
            <Toggle name="preserve_a_time" form={optionForm}>
              Preserve a-time
            </Toggle>
            <Popover placement="right" verticalPlacement="center">
              In order to preserve access time, toggle it on.
            </Popover>
          </Box>
          <MigrateFileOption />
          <Box className="flex flex-col gap-1">
            <Box className="flex gap-1 items-center mb-2">
              <Text>Skip Files modified in last</Text>
              <Popover placement="right" verticalPlacement="center">
                Skip Files that are recently modified to avoid the need to
                migrate multiple times. These will be migrated during cutover.
              </Popover>
            </Box>
            <Box className="flex gap-2 pr-5">
              <FormFieldInputNew
                form={optionForm}
                name="skipFileNum"
                placeholder="Number e.g. 10"
              />
              <Box className="w-40">
                <FormFieldSelect
                  name="skipFileOption"
                  form={optionForm}
                  options={SKIP_FILE_OPTIONS}
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
                  >
                    Download Template
                  </Button>
                  <Popover>Download/Upload GID & UID Mapping</Popover>
                </Box>
              }
              errorMessage={
                optionForm?.formErrors?.["upload_uid_mapping.fileName"]
              }
              showError={
                optionForm?.formErrors?.["upload_uid_mapping.fileName"] ?? false
              }
            />
          ) : (
            <FormFieldUploadFile
              form={optionForm}
              label="Upload SID Mapping"
              name="upload_sid_mapping"
              placeholder="Choose a file"
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
                  >
                    Download Template
                  </Button>
                  <Popover>Download/Upload SID Mapping</Popover>
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
