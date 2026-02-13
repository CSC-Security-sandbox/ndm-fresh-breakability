import HelpDrawerLayout from "@modules/Help/components/shared/HelpDrawerLayout";
import { HELP_ITEMS_ENUM } from "@modules/Help/constants/help.constants";
import AsupMetricsContent from "./components/AsupMetricsContent";
import AsupConsentModal from "./components/AsupConsentModal";

const AsupMetricsSharing = () => {
  return (
    <>
      <HelpDrawerLayout
        label={HELP_ITEMS_ENUM.ASUP_METRICS_SHARING}
        width="50rem"
        contentClassName="p-6"
      >
        <AsupMetricsContent />
      </HelpDrawerLayout>
      <AsupConsentModal />
    </>
  );
};

export default AsupMetricsSharing;
