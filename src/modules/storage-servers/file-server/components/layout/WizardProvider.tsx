import { Box } from "@components/container/index";
import AppFooter from "@/components/layout/app-footer/AppFooter";
import { Wizard } from "@netapp/bxp-design-system-react";
import ServiceAndProtocol from "@modules/storage-servers/file-server//components/steps/ServerType/ServerType";
import ValidateConnection from "@modules/storage-servers/file-server//components/steps/ValidateConnection/ValidateConnection";
import JobConfig from "@modules/storage-servers/file-server//components/steps/JobConfig/JobConfig";
import CustomStepLayout from "./CustomStepLayout";
import Footer from "@modules/storage-servers/file-server//components/footer/Footer";
import Credentials from "@modules/storage-servers/file-server//components/steps/Credentials/Credentials";
import { WizardProviderPropsType } from "../file-server.interface";

const STEPS_MAP = {
  "service-protocol": ServiceAndProtocol,
  "credentials-details": Credentials,
  "validate-connection": ValidateConnection,
  "working-directory": JobConfig,
};

const WizardProvider = ({ STEPS_PATHS }: WizardProviderPropsType) => {
  return (
    <Box className="w-full py-5 h-[70vh]">
      <Wizard
        stepsMap={STEPS_MAP}
        stepPaths={STEPS_PATHS}
        initialState={{}}
        initialStep="service-protocol"
        initialPath="default"
      >
        <AppFooter footerContent={<Footer />} />
        <CustomStepLayout />
      </Wizard>
    </Box>
  );
};

export default WizardProvider;
