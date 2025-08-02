import Box from "@/components/container/Box";
import { Card } from "@netapp/bxp-design-system-react";
import { ABOUT_NDM_CONSTANTS } from "@modules/Help/components/about-ndm/constants/about-ndm.constants";

const AboutNDMContent = () => {
  return (
    <Card>
      <Box className="flex flex-col gap-6 p-10 items-center">
        <Box className="flex flex-row items-center">
          <Box className="Box-lg font-semibold mr-2">
            {ABOUT_NDM_CONSTANTS.BUILDER_VERSION}
          </Box>
          {ABOUT_NDM_CONSTANTS.BUILDER_VERSION_VALUE}
        </Box>
        <Box className="flex flex-row items-center">
          <Box className="Box-lg font-semibold mr-2">
            {ABOUT_NDM_CONSTANTS.CONTACT_US}
          </Box>
          <u className="text-blue-500">
            {ABOUT_NDM_CONSTANTS.CONTACT_US_VALUE}
          </u>
        </Box>
      </Box>
    </Card>
  );
};

export default AboutNDMContent;
