import { Card, Layout, WizardHeader } from "@netapp/bxp-design-system-react";
import { InfoIcon } from "@netapp/bxp-style/react-icons/Notification";
import { useDrawerNavigation } from "@hooks/useDrawerNavigation";
import Help from "@modules/Help/components/Help";
import { SupportBundleProvider } from "@modules/Help/components/support-bundle/context/SupportBundleContext";
import SupportBundleContent from "@modules/Help/components/support-bundle/components/SupportBundleContent";
import { HELP_ITEMS_ENUM } from "@modules/Help/constants/help.constants";

const SupportBundle = () => {
  const { handleCloseDrawer } = useDrawerNavigation("help", <Help />);

  return (
    <SupportBundleProvider>
      <Card className="h-full w-[50rem]">
        <Layout.Page>
          <WizardHeader
            Icon={InfoIcon}
            label={HELP_ITEMS_ENUM.SUPPORT_BUNDLE}
            onClose={handleCloseDrawer}
          />
          <Layout.Content>
            <SupportBundleContent />
          </Layout.Content>
        </Layout.Page>
      </Card>
    </SupportBundleProvider>
  );
};

export default SupportBundle;
