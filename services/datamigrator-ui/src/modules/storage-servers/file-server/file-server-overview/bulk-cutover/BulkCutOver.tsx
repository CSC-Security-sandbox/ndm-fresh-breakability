import CustomStepLayout from "@modules/storage-servers/file-server/components/layout/CustomStepLayout";
import { Box } from "@components/container/index";
import AppFooter from "@components/layout/app-footer/AppFooter";
import { Wizard } from "@netapp/bxp-design-system-react";
import {
  CUT_OVER_STEPS_MAP,
  CUT_OVER_STEPS_PATHS,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/bulk-cutover.constant";
import BulkCutOverFooter from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/BulkCutOverFooter";
import BulkCutOverContextProvider from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/context/BulkCutOverContextProvider";
import { withBulkCutOver } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/context/withBulkCutOver";

const BulkCutOverContextWrapper = withBulkCutOver(BulkCutOverContextProvider);

const BulkCutOver = () => {
  return (
    <Box className="w-full h-[70vh]">
      <BulkCutOverContextWrapper>
        <Box className="font-semibold text-lg pt-8 px-8">Bulk Cutover</Box>
        <Wizard
          stepsMap={CUT_OVER_STEPS_MAP}
          stepPaths={CUT_OVER_STEPS_PATHS}
          initialState={{}}
          initialStep="select-path"
          initialPath="default"
        >
          <CustomStepLayout />
          <AppFooter footerContent={<BulkCutOverFooter />} />
        </Wizard>
      </BulkCutOverContextWrapper>
    </Box>
  );
};

export default BulkCutOver;
