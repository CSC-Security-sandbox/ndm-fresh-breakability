import { BlueXpFormType, isBundleReadyApiType } from "@/types/app.type";
import { formatDateToYMD } from "@/utils/dateFormatter";
import {
  useFetchProjectWithWorkerQuery,
  useGenerateSupportBundleMutation,
  useLazyDownloadSupportBundleQuery,
  useLazyIsBundleReadyQuery,
} from "@api/configApi";
import { notify } from "@components/notification/NotificationWrapper";
import {
  INITIAL_FORM_STATE,
  SUPPORT_BUNDLE_FORM_VALIDATION_SCHEMA,
} from "@modules/Help/components/support-bundle/constants/support-bundle.constant";
import { SupportBundleContext } from "@modules/Help/components/support-bundle/context/context";
import {
  SupportBundleContextType,
  SupportBundleFormType,
  SupportBundlePayloadType,
} from "@modules/Help/components/support-bundle/types/support-bundle.types";
import { createAndDownloadBlob, getMimeType } from "@modules/jobs/jobs.utils";
import { useForm } from "@netapp/bxp-design-system-react";
import { RootStateType } from "@store/store";
import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useTreeSelect } from "@modules/Help/components/support-bundle/hooks/useTreeSelect";
import { buildProjectWorkerMap } from "@modules/Help/components/support-bundle/utils/support-bundle.utils";

export const SupportBundleProvider = ({
  children,
}: React.PropsWithChildren) => {
  const supportBundleForm: BlueXpFormType<SupportBundleFormType> = useForm(
    INITIAL_FORM_STATE,
    SUPPORT_BUNDLE_FORM_VALIDATION_SCHEMA
  );
  const [bundleStatus, setBundleStatus] = useState<isBundleReadyApiType>(
    {} as isBundleReadyApiType
  );
  const [lastFormChangeTime, setLastFormChangeTime] = useState<Date>(
    new Date()
  );
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const [generateBundle] = useGenerateSupportBundleMutation();
  const [downloadBundle, { isLoading: isDownloading }] =
    useLazyDownloadSupportBundleQuery();
  const [isBundleReady] = useLazyIsBundleReadyQuery();
  const { data: projectWorkerData } = useFetchProjectWithWorkerQuery();

  const permissionData = useSelector(
    (state: RootStateType) => state?.permissionSlice?.userPermissions
  );

  const {
    selectedItems,
    treeSelectStyles,
    handleSelectionChange,
    wrapperClass,
  } = useTreeSelect();

  // IS BUNDLE READY POLLING API
  useEffect(() => {
    const pollingInterval =
      Number(
        window?.env?.VITE_TIME_INTERVAL || import.meta.env.VITE_TIME_INTERVAL
      ) || 5000;

    const pollBundleStatus = async () => {
      try {
        const _isBundleReadyResponse = await isBundleReady().unwrap();

        if (isInitialLoad && _isBundleReadyResponse?.filters) {
          const startDate = _isBundleReadyResponse.filters.startDate
            ? new Date(_isBundleReadyResponse.filters.startDate)
            : null;
          const endDate = _isBundleReadyResponse.filters.endDate
            ? new Date(_isBundleReadyResponse.filters.endDate)
            : null;

          if (startDate && endDate) {
            supportBundleForm.resetForm({
              ...supportBundleForm.formState,
              startDate,
              endDate,
            });
            if (_isBundleReadyResponse.createdAt) {
              setLastFormChangeTime(new Date(_isBundleReadyResponse.createdAt));
            }
          }
          setIsInitialLoad(false);
        }
        setBundleStatus(_isBundleReadyResponse);
      } catch (error) {
        console.error("Support Bundle Ready Status", error);
        setBundleStatus({
          isBundleReady: false,
          isProcessing: false,
          error: error?.data?.message,
          filters: undefined,
          createdAt: undefined,
        });
      }
    };
    const intervalId = setInterval(pollBundleStatus, pollingInterval);
    pollBundleStatus();
    return () => {
      clearInterval(intervalId);
    };
  }, [isBundleReady, lastFormChangeTime]);

  // DOWNLOAD SUPPORT BUNDLE
  const handleDownloadReport = async () => {
    try {
      const response = await downloadBundle().unwrap();
      const mimeType = getMimeType("ZIP");
      createAndDownloadBlob(
        response,
        mimeType,
        `ndm_log_${permissionData?.id}.zip`
      );
    } catch (error) {
      console.error("Failed to download Error Report:", error?.data?.message);
      notify.error(error?.data?.message || "Failed to download Error Report.");
    }
  };

  const updateFormField = (field: string, value: any) => {
    supportBundleForm.resetForm({
      ...supportBundleForm.formState,
      [field]: value,
    });
    if (field !== "isProcessing") {
      setLastFormChangeTime(new Date());
    }
  };

  const handleDateChange = (value: any) => {
    if (!value) return;
    const { initialDate, endDate } = value;
    supportBundleForm.resetForm({
      ...supportBundleForm?.formState,
      startDate: initialDate,
      endDate: endDate,
    });
    setLastFormChangeTime(new Date());
  };

  const handleGenerateBundle = async () => {
    if (!supportBundleForm?.isValid) return;

    const { formState } = supportBundleForm;
    const otherMetrics =
      (formState?.otherMetrics &&
        formState?.otherMetrics?.map((metric: any) => metric?.label)) ||
      [];

    const payload: SupportBundlePayloadType = {
      projectWorkerMap: buildProjectWorkerMap(formState, projectWorkerData),
      startDate: formatDateToYMD(formState?.startDate),
      endDate: formatDateToYMD(formState?.endDate),
      otherMetrics,
    };
    try {
      await generateBundle({ payload }).unwrap();
      const _isBundleReadyResponse = await isBundleReady().unwrap();
      if (_isBundleReadyResponse) {
        setBundleStatus(_isBundleReadyResponse);
      }
      notify.success("Support bundle generation started successfully.");
    } catch (error) {
      notify.error("Error generating support bundle.");
      console.error("Error generating support bundle:", error);
    }
  };

  useEffect(() => {
    if (bundleStatus?.error) {
      updateFormField("isProcessing", false);
      notify.error(
        bundleStatus?.error || "Something went while bundle generation."
      );
    }
  }, [bundleStatus?.error]);

  const supportBundleContextValue: SupportBundleContextType = {
    supportBundleForm,
    handleDateChange,
    handleDownloadReport,
    handleGenerateBundle,
    bundleStatus,
    selectedItems,
    treeSelectStyles,
    handleSelectionChange,
    wrapperClass,
    projectWorkerData,
    isDownloading,
  };

  return (
    <SupportBundleContext.Provider value={supportBundleContextValue}>
      {children}
    </SupportBundleContext.Provider>
  );
};
