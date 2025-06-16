import { useForm } from "@netapp/bxp-design-system-react";
import { UploadedFilePropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/bulk-manual-upload-file.types";
import {
  INITIAL_VALUE_FORM,
  VALIDATION_SCHEMA,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/BulkManualUploadFile.constants";
import {
  useLazyDownloadExportPathSourceTemplateQuery,
  useSubmitExportPathSourceFileMutation,
  useUploadExportPathSourceFileMutation,
} from "@/api/configApi";
import { useModalManager } from "@/hooks/useModalManager";
import { useEffect, useMemo, useState } from "react";
import { getFileServerId } from "@modules/storage-servers/file-server/file-server-overview/file-server.utils";
import { notify } from "@/components/notification/NotificationWrapper";
import { BulkManualUploadModalContent } from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/components/BulkManualUploadModalContent";
import { BulkManualUploadModalFooter } from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/components/BulkManualUploadModalFooter";
import { ConfigListTypeApiType, VolumeType } from "@/types/app.type";

export const BulkManualUpload = (fileServerDetails: ConfigListTypeApiType) => {
  // Initialize form and state
  const form = useForm(INITIAL_VALUE_FORM, VALIDATION_SCHEMA);
  const [exportPathSourceData, setExportPathSourceData] =
    useState<UploadedFilePropsType>();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // API hooks
  const [downloadTemplate] = useLazyDownloadExportPathSourceTemplateQuery();
  const [uploadExportPathSourceFile] = useUploadExportPathSourceFileMutation();
  const [submitExportPathSourceFile] = useSubmitExportPathSourceFileMutation();

  // Modal management
  const { openModal, closeModal } = useModalManager();

  const fileServerId = useMemo(() => {
    if (fileServerDetails?.fileServers) {
      return getFileServerId(fileServerDetails, "NFS");
    }
  }, [fileServerDetails?.fileServers]);

  const resetStateAndCloseModal = () => {
    form.resetForm(INITIAL_VALUE_FORM);
    setExportPathSourceData(undefined);
    setError("");
    closeModal();
  };

  const onSubmit = async () => {
    exportPathSourceData?.uploadId ? submitFile() : uploadFile();
  };

  useEffect(() => {
    if (form?.formState?.exportPathSource?.fileName) openUploadModal();
    setError("");
  }, [
    form?.formState?.exportPathSource?.fileName,
    form?.formErrors,
    exportPathSourceData,
    isLoading,
  ]);

  const submitFile = async () => {
    try {
      startLoading();
      await submitExportPathSourceFile({
        uploadId: exportPathSourceData.uploadId,
      }).unwrap();
      notify.success("File uploaded successfully.");
      resetStateAndCloseModal();
    } catch (error) {
      handleError(error, "Failed to upload file");
    } finally {
      setIsLoading(false);
    }
  };

  const uploadFile = async () => {
    try {
      startLoading();
      const { exportPathSource } = form?.formState;
      const _exportPathSourceData = await uploadExportPathSourceFile({
        fileServerId,
        body: exportPathSource,
      }).unwrap();
      setExportPathSourceData(_exportPathSourceData);
    } catch (error) {
      handleError(error, "Failed to upload file");
    } finally {
      setIsLoading(false);
    }
  };

  const startLoading = () => {
    setIsLoading(true);
    setError("");
  };

  const handleError = (error: any, defaultMessage: string) => {
    const message = error?.data?.message || error?.message || defaultMessage;
    setError(message);
    console.error(message);
    notify.error(message);
  };

  const openUploadModal = () => {
    openModal({
      modalHeader: "Upload Export Paths File",
      modalContent: BulkManualUploadModalContent(
        form,
        exportPathSourceData,
        error,
        downloadTemplate
      ),
      modalFooter: BulkManualUploadModalFooter(
        form,
        isLoading,
        onSubmit,
        resetStateAndCloseModal
      ),
    });
  };

  return { openUploadModal };
};
