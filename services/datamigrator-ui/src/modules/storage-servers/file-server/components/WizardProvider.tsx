import CustomStepLayout from "@modules/storage-servers/file-server/components/layout/CustomStepLayout";
import { Box } from "@components/container/index";
import { Wizard } from "@netapp/bxp-design-system-react";
import FileServerFooter from "@modules/storage-servers/file-server/components/FileServerFooter/FileServerFooter";
import {
  STEPS_MAP,
  STEPS_PATHS,
} from "@modules/storage-servers/file-server/file-server.constant";
import AppFooter from "@components/layout/app-footer/AppFooter";

const WizardProvider = () => {
  return (
    <Box className="w-full py-5 h-[75vh]">
      <Wizard
        stepsMap={STEPS_MAP}
        stepPaths={STEPS_PATHS}
        initialState={{}}
        initialStep="server-type"
        initialPath="default"
      >
        <CustomStepLayout />
        <AppFooter footerContent={<FileServerFooter />} />
      </Wizard>
    </Box>
  );
};

export default WizardProvider;
