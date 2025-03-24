import React, { useState, useEffect, useCallback } from "react";
import { useUpdateJobRunStatusMutation } from "@api/jobsApi";
import { JOB_ACTION_STATUS_ENUM } from "@/types/app.type";
import { notify } from "@components/notification/NotificationWrapper";
import { useDispatch } from "react-redux";
import {
  setModalClose,
  setModalProps,
} from "@store/reducer/commonComponentSlice";
import { hasUniqueStatus } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/Review/components/ActionButtons.utils";
import {
  rowMenuPropsType,
  StatusType,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/Review/components/ActionButtons.types";
import { STATUS_TYPE } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/Review/components/ActionButton.constant";

export const useJobRunStatus = (
  rows: rowMenuPropsType[],
  selectedJobRunIds: string[],
  createModalContent: React.FC,
  createModalFooter: {
    (status: JOB_ACTION_STATUS_ENUM): React.JSX.Element;
    (arg0: JOB_ACTION_STATUS_ENUM): any;
  }
) => {
  const [updateStatus, { isLoading: isUpdating }] =
    useUpdateJobRunStatusMutation();
  const [isButtonDisabled, setIsButtonDisabled] = useState(STATUS_TYPE);
  const [selectedId, SetSelectedId] = useState<string[]>([]);
  const dispatch = useDispatch();

  useEffect(() => {
    const selectedRows = selectedJobRunIds.map((selectedId: any) => ({
      jobRunId: rows[selectedId]?.jobRunId,
      status: rows[selectedId]?.status as StatusType,
    }));
    const jobRunIds = selectedRows.map((row) => row.jobRunId);
    SetSelectedId(jobRunIds);
    const result = hasUniqueStatus(selectedRows);
    setIsButtonDisabled(result);
  }, [selectedJobRunIds]);

  const updateStatusApi = useCallback(
    async (status: JOB_ACTION_STATUS_ENUM) => {
      try {
        await updateStatus({ ids: selectedId, status }).unwrap();
        notify.success("Successfully updated the status of Job.");
      } catch (error) {
        notify.error("Failed to update Job Status.");
        console.error(error);
      }
    },
    [selectedId, updateStatus]
  );

  const submitAction = useCallback(
    (status: JOB_ACTION_STATUS_ENUM) => {
      updateStatusApi(status);
      dispatch(setModalClose());
    },
    [updateStatusApi, dispatch]
  );

  const handleUpdateStatus = useCallback(
    (status: JOB_ACTION_STATUS_ENUM) => {
      if (status === JOB_ACTION_STATUS_ENUM.STOP) {
        dispatch(
          setModalProps({
            isOpen: true,
            modalHeader: "Confirmation for Job Stop",
            modalContent: createModalContent(status, submitAction),
            modalFooter: createModalFooter(status),
          })
        );
      } else {
        updateStatusApi(status);
      }
    },
    [dispatch, updateStatusApi, createModalContent, submitAction]
  );

  return {
    isButtonDisabled,
    isUpdating,
    handleUpdateStatus,
    submitAction,
    dispatch,
    setModalClose,
  };
};
