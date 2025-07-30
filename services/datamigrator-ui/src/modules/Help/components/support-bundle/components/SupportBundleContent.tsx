import { Button, Card } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { useContext } from "react";
import { Show } from "@components/show/Show";
import ReportsGeneratingLoader from "@components/ReportsGeneratingLoader/ReportsGeneratingLoader";
import { SupportBundleContext } from "@modules/Help/components/support-bundle/context/context";
import {
  DOWNLOAD_REPORT_LABEL,
  GENERATE_SUPPORT_BUNDLE_LABEL,
  GENERATING_SUPPORT_BUNDLE_LABEL,
} from "@modules/Help/components/support-bundle/constants/support-bundle.constant";
import SupportBundleForm from "@modules/Help/components/support-bundle/components/SupportBundleForm";

const SupportBundleContent = () => {
  const {
    handleDownloadReport,
    handleGenerateBundle,
    isDownloadDisabled,
    isGenerateDisabled,
    showLoader,
  } = useContext(SupportBundleContext);

  return (
    <Card className="p-6 flex flex-col m-8">
      <Button
        className="ml-auto"
        disabled={isDownloadDisabled}
        onClick={handleDownloadReport}
      >
        {DOWNLOAD_REPORT_LABEL}
      </Button>

      <SupportBundleForm />

      <Box className="flex justify-center">
        <Show>
          <Show.When isTrue={showLoader}>
            <ReportsGeneratingLoader label={GENERATING_SUPPORT_BUNDLE_LABEL} />
          </Show.When>
          <Show.Else>
            <Button
              onClick={handleGenerateBundle}
              disabled={isGenerateDisabled}
            >
              {GENERATE_SUPPORT_BUNDLE_LABEL}
            </Button>
          </Show.Else>
        </Show>
      </Box>
    </Card>
  );
};

export default SupportBundleContent;
