import CustomStepLayout from "@modules/storage-servers/file-server//components/layout/CustomStepLayout";
import { Box } from "@components/container/index";
import AppFooter from "@/components/layout/app-footer/AppFooter";
import { Wizard } from "@netapp/bxp-design-system-react";
import BulkMigrateContextProvider from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import BulkMigrateFooter from "./footer/BulkMigrateFooter";
import { withBulkMigrateCreateForm } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/withBulkMigrateCreateForm";
import {
  STEPS_MAP_BULK_MIGRATION,
  STEPS_PATHS_BULK_MIGRATION,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";

const BulkMigrateContextWrapper = withBulkMigrateCreateForm(
  BulkMigrateContextProvider
);

const BulkMigrateWizardProvider = () => {
  return (
    <Box className="w-full py-5 h-[80vh]">
      <BulkMigrateContextWrapper>
        <Wizard
          stepsMap={STEPS_MAP_BULK_MIGRATION}
          stepPaths={STEPS_PATHS_BULK_MIGRATION}
          initialState={{}}
          initialStep="mapping"
          initialPath="default"
        >
          <AppFooter footerContent={<BulkMigrateFooter />} />
          <CustomStepLayout />
        </Wizard>
      </BulkMigrateContextWrapper>
    </Box>
  );
};

export default BulkMigrateWizardProvider;
