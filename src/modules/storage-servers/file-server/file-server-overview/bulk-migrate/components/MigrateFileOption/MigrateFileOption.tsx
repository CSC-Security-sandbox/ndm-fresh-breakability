import { Box } from "@components/container/index";
import DateTimePickerWrapper from "./ExcludeDateTimePickerWrapper";
import { Popover, RadioButton, Text } from "@netapp/bxp-design-system-react";
import { MIGRATE_OPTION_ENUM } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { useContext } from "react";

const MigrateFileOption = () => {
  const { optionForm } = useContext(BulkMigrateContext);
  return (
    <Box className="w-4/6">
      <Box className="flex gap-1 items-center mb-2">
        <Text>Migrate File</Text>
        <Popover placement="right" verticalPlacement="center">
          Migrate all files or exclude files older than date?
        </Popover>
      </Box>
      <Box className="flex gap-6">
        <RadioButton
          form={optionForm}
          name="migrate_file_option"
          value={MIGRATE_OPTION_ENUM.ALL}
        >
          All
        </RadioButton>
        <RadioButton
          form={optionForm}
          name="migrate_file_option"
          value={MIGRATE_OPTION_ENUM.EXCLUDE}
        >
          Exclude file older than (UTC)
        </RadioButton>
      </Box>
      {optionForm.formState.migrate_file_option ===
        MIGRATE_OPTION_ENUM.EXCLUDE && (
        <Box className="flex gap-3 mt-3">
          <DateTimePickerWrapper form={optionForm} />
        </Box>
      )}
    </Box>
  );
};

export default MigrateFileOption;
