import HelpDrawerLayout from "@modules/Help/components/shared/HelpDrawerLayout";
import { HELP_ITEMS_ENUM } from "@modules/Help/constants/help.constants";
import AsupMetricsContent from "./components/AsupMetricsContent";

/**
 * AsupMetricsSharing - Container component for ASUP settings in the Help drawer.
 * 
 * The initial ASUP preference is set by the instance creator on the login profile page.
 * App Admins can toggle the setting here. Other roles can only view.
 */
const AsupMetricsSharing = () => {
  return (
    <HelpDrawerLayout
      label={HELP_ITEMS_ENUM.ASUP_METRICS_SHARING}
      width="50rem"
      contentClassName="p-6"
    >
      <AsupMetricsContent />
    </HelpDrawerLayout>
  );
};

export default AsupMetricsSharing;
