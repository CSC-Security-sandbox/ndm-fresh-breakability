import CustomStepLayout from "@modules/storage-servers/file-server//components/layout/CustomStepLayout";
import { Box } from "@components/container/index";
import AppFooter from "@components/layout/app-footer/AppFooter";
import { Wizard } from "@netapp/bxp-design-system-react";
import {
  CUT_OVER_STEPS_MAP,
  CUT_OVER_STEPS_PATHS,
} from "./bulk-cutover.constant";
import BulkCutOverFooter from "./components/BulkCutOverFooter";
import BulkCutOverContextProvider from "./context/BulkCutOverContextProvider";
import { withBulkCutOver } from "./context/withBulkCutOver";

const BulkCutOverContextWrapper = withBulkCutOver(BulkCutOverContextProvider);

const BulkCutOver = () => {
  return (
    <Box className="w-full h-[70vh] overflow-hidden">
      <BulkCutOverContextWrapper>
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
