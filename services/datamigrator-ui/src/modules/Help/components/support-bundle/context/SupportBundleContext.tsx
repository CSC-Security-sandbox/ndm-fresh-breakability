import { BlueXpFormType, AsupTransmissionState, isBundleReadyApiType } from "@/types/app.type";
import { formatDateToYMD } from "@/utils/dateFormatter";
import {
  useFetchProjectWithWorkerQuery,
  useGenerateSupportBundleMutation,
  useLazyDownloadSupportBundleQuery,
  useLazyIsBundleReadyQuery,
  useLazyGetAsupStatusQuery,
  useSendSupportBundleMutation,
} from "@api/configApi";
import { notify } from "@components/notification/NotificationWrapper";
import {
  INITIAL_FORM_STATE,
  METRICS_OPTIONS,
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
import {
  buildProjectWorkerMap,
  createSupportBundleInfoMessage,
  extractProjectAndWorkerNames,
} from "@modules/Help/components/support-bundle/utils/support-bundle.utils";

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

  const [infoMessage, setInfoMessage] = useState<Record<string, string>>({});
  const [lastFormChangeTime, setLastFormChangeTime] = useState<Date>(
    new Date()
  );
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [sentBundleFingerprint, setSentBundleFingerprint] = useState<string | null>(
    null
  );

  const [generateBundle] = useGenerateSupportBundleMutation();
  const [downloadBundle, { isFetching: isDownloading }] =
    useLazyDownloadSupportBundleQuery();
  const [sendSupportBundle, { isLoading: isSending }] =
    useSendSupportBundleMutation();
  const [isBundleReady] = useLazyIsBundleReadyQuery();
  const [getAsupStatus] = useLazyGetAsupStatusQuery();
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

  const getBundleFingerprint = (status: isBundleReadyApiType) => {
    if (!status?.isBundleReady || !status?.filters) return null;
    return `${status.createdAt || ""}|${status.filters.startDate}|${
      status.filters.endDate
    }|${status.filters.projectWorkerMap?.length || 0}|${
      status.filters.otherMetrics?.join(",") || ""
    }`;
  };

  const [prevAsupStatus, setPrevAsupStatus] = useState<AsupTransmissionState | null>(null);

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

          const transformedMetrics =
            _isBundleReadyResponse?.filters?.otherMetrics?.map(
              (item: string) => {
                const foundOption = METRICS_OPTIONS.find(
                  (option) => option.label === item
                );
                return foundOption || { label: item, value: 0 };
              }
            );

          const { projectNames, workerNames } = extractProjectAndWorkerNames(
            _isBundleReadyResponse?.filters?.projectWorkerMap,
            projectWorkerData?.data?.items || []
          );

          const infoMessage = createSupportBundleInfoMessage(
            startDate,
            endDate,
            projectNames,
            workerNames,
            transformedMetrics || []
          );

          setInfoMessage(infoMessage);

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
        const currentFingerprint = getBundleFingerprint(_isBundleReadyResponse);
        if (!currentFingerprint || currentFingerprint !== sentBundleFingerprint) {
          setSentBundleFingerprint(null);
        }
      } catch (error) {
        console.error("Support Bundle Ready Status", error);
        notify.error(error?.data?.message || "Failed to check bundle status.");
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
  }, [isBundleReady, lastFormChangeTime, sentBundleFingerprint]);

  // ASUP TRANSMISSION STATUS POLLING
  useEffect(() => {
    if (prevAsupStatus?.status !== 'transmitting') return;

    const pollingInterval =
      Number(
        window?.env?.VITE_TIME_INTERVAL || import.meta.env.VITE_TIME_INTERVAL
      ) || 5000;

    const pollAsupStatus = async () => {
      try {
        const asupState = await getAsupStatus().unwrap();

        if (asupState === null) {
          notify.error("Support bundle transmission status lost. Please retry.");
          setSentBundleFingerprint(null);
          setPrevAsupStatus({ status: 'failed', startedAt: prevAsupStatus.startedAt });
          return;
        }

        if (asupState?.status === 'completed') {
          notify.success("Support bundle sent to NetApp Support successfully.");
          const currentFingerprint = getBundleFingerprint(bundleStatus);
          if (currentFingerprint) setSentBundleFingerprint(currentFingerprint);
          setPrevAsupStatus(asupState);
        } else if (asupState?.status === 'failed') {
          notify.error(asupState?.error || "Failed to send Support Bundle to NetApp Support.");
          setSentBundleFingerprint(null);
          setPrevAsupStatus(asupState);
        }
      } catch (error) {
        console.error("ASUP Status Poll Error:", error);
      }
    };

    const intervalId = setInterval(pollAsupStatus, pollingInterval);
    pollAsupStatus();
    return () => clearInterval(intervalId);
  }, [prevAsupStatus?.status]);

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

  // SEND SUPPORT BUNDLE TO NETAPP SUPPORT (ASUP)
  const handleSendToNetAppSupport = async () => {
    try {
      await sendSupportBundle().unwrap();
      // Fire-and-forget: backend returns immediately; real outcome comes via ASUP status polling.
      const currentFingerprint = getBundleFingerprint(bundleStatus);
      if (currentFingerprint) setSentBundleFingerprint(currentFingerprint);
      setPrevAsupStatus({ status: 'transmitting', startedAt: new Date().toISOString() });
      notify.info("Support bundle transmission started. You will be notified once it completes.");
    } catch (error) {
      console.error("Failed to send Support Bundle:", error?.data?.message);
      notify.error(error?.data?.message || "Failed to send Support Bundle to NetApp Support.");
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
      projectWorkerMap: buildProjectWorkerMap(
        formState,
        projectWorkerData?.data?.items || []
      ),
      startDate: formatDateToYMD(formState?.startDate),
      endDate: formatDateToYMD(formState?.endDate),
      otherMetrics,
    };
    try {
      await generateBundle({ payload }).unwrap();
      setSentBundleFingerprint(null);
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
    if (selectedItems) {
      supportBundleForm.resetForm({
        ...supportBundleForm.formState,
        projectWorker: selectedItems,
      });
    }
  }, [selectedItems]);

  const supportBundleContextValue: SupportBundleContextType = {
    supportBundleForm,
    handleDateChange,
    handleDownloadReport,
    handleSendToNetAppSupport,
    handleGenerateBundle,
    bundleStatus,
    selectedItems,
    treeSelectStyles,
    handleSelectionChange,
    wrapperClass,
    projectWorkerData,
    isDownloading,
    isSending,
    isTransmitting: prevAsupStatus?.status === 'transmitting',
    isSupportBundleAlreadySent:
      getBundleFingerprint(bundleStatus) !== null &&
      getBundleFingerprint(bundleStatus) === sentBundleFingerprint,
    infoMessage,
  };

  return (
    <SupportBundleContext.Provider value={supportBundleContextValue}>
      {children}
    </SupportBundleContext.Provider>
  );
};
