import { InfoIcon } from "@netapp/bxp-style/react-icons/Notification";
import { Card, Layout, WizardHeader } from "@netapp/bxp-design-system-react";
import { useDrawerNavigation } from "@hooks/useDrawerNavigation";
import Help from "@modules/Help/components/Help";
import AboutNDMContent from "@modules/Help/components/about-ndm/components/AboutNDMContent";
import { HELP_ITEMS_ENUM } from "@modules/Help/constants/help.constants";

const AboutNDM = () => {
  const { handleCloseDrawer } = useDrawerNavigation("help", <Help />);
  return (
    <Card className="h-full w-[40rem]">
      <Layout.Page>
        <WizardHeader
          Icon={InfoIcon}
          label={HELP_ITEMS_ENUM.ABOUT_NDM}
          onClose={handleCloseDrawer}
        />
        <Layout.Content className="p-10">
          <AboutNDMContent />
        </Layout.Content>
      </Layout.Page>
    </Card>
  );
};

export default AboutNDM;
