import React, { useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useForm } from "@netapp/bxp-design-system-react";
import {
  useLazyDownloadSupportBundleQuery,
  useFetchProjectWithWorkerQuery,
  useGenerateSupportBundleMutation,
  useCheckBundleReadyStatusQuery,
} from "@api/configApi";
import { formatDateToYMD } from "@/utils/dateFormatter";
import { createAndDownloadBlob, getMimeType } from "@modules/jobs/jobs.utils";
import { notify } from "@components/notification/NotificationWrapper";
import { RootStateType } from "@store/store";
import { setLastGeneratedBundlePayload } from "@store/reducer/appSlice";
import { buildProjectWorkerMap } from "@modules/Help/components/support-bundle/utils/support-bundle.utils";
import {
  SupportBundleContextType,
  SupportBundlePayloadType,
} from "@modules/Help/components/support-bundle/types/support-bundle.types";
import { SupportBundleContext } from "@modules/Help/components/support-bundle/context/context";
import { useTreeSelect } from "@modules/Help/components/support-bundle/hooks/useTreeSelect";
import { INITIAL_FORM_STATE } from "@modules/Help/components/support-bundle/constants/support-bundle.constant";

export const SupportBundleProvider = ({
  children,
}: React.PropsWithChildren) => {
  const dispatch = useDispatch();
  const form = useForm(INITIAL_FORM_STATE);
  const {
    selectedItems,
    treeSelectStyles,
    handleSelectionChange,
    wrapperClass,
  } = useTreeSelect();

  const [generateBundle] = useGenerateSupportBundleMutation();
  const [downloadBundle] = useLazyDownloadSupportBundleQuery();
  const { data: projectWorkerData } = useFetchProjectWithWorkerQuery();
  const { data: bundleReadyStatus } = useCheckBundleReadyStatusQuery(null, {
    pollingInterval: Number(
      window?.env?.VITE_TIME_INTERVAL || import.meta.env.VITE_TIME_INTERVAL
    ),
    skipPollingIfUnfocused: true,
  });

  const permissionData = useSelector(
    (state: RootStateType) => state?.permissionSlice?.userPermissions
  );
  const lastGeneratedBundlePayload = useSelector(
    (state: RootStateType) => state?.appSlice?.lastGeneratedBundlePayload
  );

  const updateFormField = (field: string, value: any) => {
    form.resetForm({ ...form.formState, [field]: value });
  };

  const isFormDataDifferentFromLastBundle = () => {
    if (!lastGeneratedBundlePayload || !form?.formState || !projectWorkerData)
      return false;

    try {
      const projectWorker = Array.isArray(form?.formState?.project_worker)
        ? form?.formState?.project_worker
        : [];

      const otherMetrics = form?.formState?.other_metrics?.label
        ? [form?.formState?.other_metrics?.label]
        : [];

      const currentPayload = {
        projectWorkerMap: buildProjectWorkerMap(
          { ...form?.formState, project_worker: projectWorker },
          projectWorkerData
        ),
        startDate: formatDateToYMD(form?.formState?.start_date),
        endDate: formatDateToYMD(form?.formState?.end_date),
        otherMetrics,
      };

      return (
        JSON.stringify(currentPayload) !==
        JSON.stringify(lastGeneratedBundlePayload)
      );
    } catch (error) {
      console.error("Error comparing form data:", error);
      return false;
    }
  };

  const validateForm = () => {
    const { start_date, end_date, project_worker } = form?.formState || {};
    const isFormValid =
      start_date &&
      end_date &&
      Array.isArray(project_worker) &&
      project_worker.length > 0;
    updateFormField("isValid", isFormValid);
  };

  const formState = form?.formState || {};
  const { isValid, isProcessing, start_date, end_date, project_worker } =
    formState;

  const hasFormData = Boolean(
    start_date ||
      end_date ||
      (Array.isArray(project_worker) && project_worker.length)
  );
  const isBundleReady = bundleReadyStatus?.isBundleReady;
  const isFormDataChanged = isFormDataDifferentFromLastBundle();

  const isDownloadDisabled =
    !isBundleReady || (hasFormData && isFormDataChanged);
  const isGenerateDisabled = !isValid || (isBundleReady && !isDownloadDisabled);
  const showLoader =
    bundleReadyStatus?.isProcessing || (isProcessing && !isBundleReady);

  const handleDateChange = (value: Record<string, string>) => {
    if (!value) return;
    const { initialDate, endDate } = value;
    form.resetForm({
      ...form?.formState,
      start_date: initialDate,
      end_date: endDate,
    });
  };

  const handleDownloadReport = async () => {
    try {
      const response = await downloadBundle().unwrap();
      const mimeType = getMimeType("ZIP");
      createAndDownloadBlob(
        response,
        mimeType,
        `ndm_log-${permissionData?.id}.zip`
      );
    } catch (error) {
      console.error("Failed to download Error Report:", error?.data?.message);
      notify.error(error?.data?.message || "Failed to download Error Report.");
    }
  };

  const handleGenerateBundle = async () => {
    if (!form?.formState?.isValid) return;

    const otherMetrics = form?.formState?.other_metrics?.label
      ? [form?.formState?.other_metrics?.label]
      : [];

    const payload: SupportBundlePayloadType = {
      projectWorkerMap: buildProjectWorkerMap(
        form?.formState,
        projectWorkerData
      ),
      startDate: formatDateToYMD(form?.formState?.start_date),
      endDate: formatDateToYMD(form?.formState?.end_date),
      otherMetrics,
    };

    try {
      dispatch(setLastGeneratedBundlePayload(payload));
      await generateBundle({ payload }).unwrap();
      notify.success("Support bundle generation started successfully.");
      updateFormField("isProcessing", true);
    } catch (error) {
      notify.error("Error generating support bundle.");
      console.error("Error generating support bundle:", error);
    }
  };

  useEffect(() => {
    if (selectedItems) updateFormField("project_worker", selectedItems);
  }, [selectedItems]);

  useEffect(() => {
    validateForm();
  }, [
    form?.formState?.start_date,
    form?.formState?.end_date,
    form?.formState?.project_worker,
    form?.formState?.other_metrics,
  ]);

  useEffect(() => {
    if (bundleReadyStatus?.error) {
      updateFormField("isProcessing", false);
      notify.error(
        bundleReadyStatus?.error || "Something went while bundle generation."
      );
    }
  }, [bundleReadyStatus?.error]);

  const contextValue: SupportBundleContextType = {
    form,
    projectWorkerData,
    bundleReadyStatus,
    treeSelectStyles,
    handleSelectionChange,
    wrapperClass,
    handleDateChange,
    handleDownloadReport,
    handleGenerateBundle,
    isFormDataDifferentFromLastBundle,
    hasFormData,
    isBundleReady,
    isDownloadDisabled,
    isGenerateDisabled,
    showLoader,
  };

  return (
    <SupportBundleContext.Provider value={contextValue}>
      {children}
    </SupportBundleContext.Provider>
  );
};
