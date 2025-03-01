import CustomStepLayout from "@modules/storage-servers/file-server/components/layout/CustomStepLayout";
import { Box } from "@components/container/index";
import AppFooter from "@/components/layout/app-footer/AppFooter";
import { Wizard } from "@netapp/bxp-design-system-react";
import Footer from "./footer/Footer";
import {
  STEPS_MAP,
  STEPS_PATHS,
} from "@modules/storage-servers/file-server/file-server.constant";

const WizardProvider = () => {
  console.log("first");
  return (
    <Box className="w-full py-5 h-[calc(100vh-5rem)]">
      <Wizard
        stepsMap={STEPS_MAP}
        stepPaths={STEPS_PATHS}
        initialState={{}}
        initialStep="server-type"
        initialPath="default"
      >
        <AppFooter footerContent={<Footer />} />
        <CustomStepLayout />
      </Wizard>
    </Box>
  );
};

export default WizardProvider;
