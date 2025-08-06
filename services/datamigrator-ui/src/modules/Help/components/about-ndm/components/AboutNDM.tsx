import AboutNDMContent from "@modules/Help/components/about-ndm/components/AboutNDMContent";
import HelpDrawerLayout from "@modules/Help/components/shared/HelpDrawerLayout";
import { HELP_ITEMS_ENUM } from "@modules/Help/constants/help.constants";

const AboutNDM = () => {
  return (
    <HelpDrawerLayout label={HELP_ITEMS_ENUM.ABOUT_NDM}>
      <AboutNDMContent />
    </HelpDrawerLayout>
  );
};

export default AboutNDM;
