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
  // Initialize form handling
  const form = useForm(INITIAL_VALUE_FORM, VALIDATION_SCHEMA);
  const [exportPathSourceData, setExportPathSourceData] =
    useState<UploadedFilePropsType>();
  const [isLoading, setIsLoading] = useState<boolean>(false);

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

  const handleResetAndClose = () => {
    form.resetForm(INITIAL_VALUE_FORM);
    setExportPathSourceData(undefined);
    closeModal();
  };

  const onSubmit = async () => {
    exportPathSourceData?.uploadId
      ? submitUploadExportPathSourceFile()
      : uploadFile();
  };

  useEffect(() => {
    if (form?.formState?.exportPathSource?.fileName) openUploadModal();
  }, [
    form?.formState?.exportPathSource?.fileName,
    form?.formErrors,
    exportPathSourceData,
    isLoading,
  ]);

  const submitUploadExportPathSourceFile = async () => {
    try {
      setIsLoading(true);
      await submitExportPathSourceFile({
        uploadId: exportPathSourceData.uploadId,
      }).unwrap();
      notify.success("File uploaded successfully.");
      handleResetAndClose();
    } catch (error) {
      const errorMessage = `Failed to upload file: ${
        error?.data?.message || error?.message
      }`;
      console.error(errorMessage);
      notify.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const uploadFile = async () => {
    try {
      const { exportPathSource } = form?.formState;
      setIsLoading(true);
      const _exportPathSourceData = await uploadExportPathSourceFile({
        fileServerId,
        body: exportPathSource,
      }).unwrap();
      setExportPathSourceData(_exportPathSourceData);
    } catch (error) {
      console.error(
        `Failed to upload file: ${error?.data?.message || error?.message}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const openUploadModal = () => {
    openModal({
      modalHeader: "Upload Export Paths File",
      modalContent: BulkManualUploadModalContent(
        form,
        exportPathSourceData,
        downloadTemplate
      ),
      modalFooter: BulkManualUploadModalFooter(
        form,
        exportPathSourceData,
        isLoading,
        onSubmit,
        handleResetAndClose
      ),
    });
  };

  return {
    openUploadModal,
  };
};
