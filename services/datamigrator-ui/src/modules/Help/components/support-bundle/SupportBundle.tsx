import HelpDrawerLayout from "@modules/Help/components/shared/HelpDrawerLayout";
import { SupportBundleProvider } from "@modules/Help/components/support-bundle/context/SupportBundleContext";
import SupportBundleContent from "@modules/Help/components/support-bundle/components/SupportBundleContent";
import { HELP_ITEMS_ENUM } from "@modules/Help/constants/help.constants";

const SupportBundle = () => {
  return (
    <SupportBundleProvider>
      <HelpDrawerLayout
        label={HELP_ITEMS_ENUM.SUPPORT_BUNDLE}
        width="50rem"
        contentClassName=""
      >
        <SupportBundleContent />
      </HelpDrawerLayout>
    </SupportBundleProvider>
  );
};

export default SupportBundle;
