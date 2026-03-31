import { Button, Card, Popover } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { useContext } from "react";
import { Show } from "@components/show/Show";
import ReportsGeneratingLoader from "@components/ReportsGeneratingLoader/ReportsGeneratingLoader";
import { SupportBundleContext } from "@modules/Help/components/support-bundle/context/context";
import {
  DOWNLOAD_REPORT_LABEL,
  GENERATE_SUPPORT_BUNDLE_LABEL,
  GENERATING_SUPPORT_BUNDLE_LABEL,
  SEND_SUPPORT_BUNDLE_LABEL,
  SEND_SUPPORT_BUNDLE_TOOLTIP,
} from "@modules/Help/components/support-bundle/constants/support-bundle.constant";
import SupportBundleForm from "@modules/Help/components/support-bundle/components/SupportBundleForm";
import { formatDateToYMD } from "@/utils/dateFormatter";

const SupportBundleContent = () => {
  const {
    handleDownloadReport,
    handleSendToNetAppSupport,
    handleGenerateBundle,
    bundleStatus,
    supportBundleForm,
    isDownloading,
    isSending,
    isSupportBundleAlreadySent,
    infoMessage,
  } = useContext(SupportBundleContext);

  const { startDate, endDate } = supportBundleForm?.formState;

  // Disable if dates are different from last generated bundle
  const isDateSame =
    bundleStatus?.filters &&
    formatDateToYMD(startDate) === bundleStatus.filters.startDate &&
    formatDateToYMD(endDate) === bundleStatus.filters.endDate;

  return (
    <Card className="p-6 flex flex-col m-8">
      <Box className="flex flex-col ml-auto">
        {infoMessage?.date && (
          <Box className="ml-auto pb-1">
            <Popover>
              Support Bundle includes the following details based on your
              selection:
              <Box>{infoMessage?.date}</Box>
              <Box>{infoMessage?.projects}</Box>
              <Box>{infoMessage?.workers}</Box>
              <Box>{infoMessage?.metrics}</Box>
            </Popover>
          </Box>
        )}

        <Box className="flex gap-2 items-center">
          <Button
            className="w-44"
            disabled={!isDateSame || !bundleStatus.isBundleReady}
            onClick={handleDownloadReport}
            isSubmitting={isDownloading}
          >
            {DOWNLOAD_REPORT_LABEL}
          </Button>
          <span title={SEND_SUPPORT_BUNDLE_TOOLTIP}>
            <Button
              className="w-48"
              disabled={
                !isDateSame ||
                !bundleStatus.isBundleReady ||
                isSupportBundleAlreadySent
              }
              onClick={handleSendToNetAppSupport}
              isSubmitting={isSending}
            >
              {SEND_SUPPORT_BUNDLE_LABEL}
            </Button>
          </span>
        </Box>
      </Box>

      <SupportBundleForm />

      <Box className="flex justify-center mt-2">
        <Show>
          <Show.When isTrue={bundleStatus.isProcessing}>
            <ReportsGeneratingLoader label={GENERATING_SUPPORT_BUNDLE_LABEL} />
          </Show.When>
          <Show.Else>
            <Button
              onClick={handleGenerateBundle}
              disabled={bundleStatus.isProcessing || !supportBundleForm.isValid}
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
