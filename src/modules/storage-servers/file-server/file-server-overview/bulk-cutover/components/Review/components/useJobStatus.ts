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
  const [selectedId, setSelectedId] = useState<string[]>([]);
  const dispatch = useDispatch();
  const [selectedAction, setSelectedAction] = useState<string>("");
  const [loadingState, setLoadingState] = useState<Record<string, boolean>>({});

  const getSelectedRows = (
    rows: rowMenuPropsType[],
    selectedJobRunIds: string[]
  ) => {
    return selectedJobRunIds
      .map((selectedId: string) => {
        // Find the row by ID or use indexed access
        const row =
          rows.find((row) => row?.id === selectedId) || rows[selectedId];

        if (!row) {
          return null;
        }
        return { jobRunId: row.jobRunId, status: row.status as StatusType };
      })
      .filter(Boolean);
  };

  useEffect(() => {
    if (rows.length > 0) {
      const selectedRows = getSelectedRows(rows, selectedJobRunIds);
      const jobRunIds = selectedRows.map((row) => row.jobRunId);

      setSelectedId(jobRunIds);
      setIsButtonDisabled(hasUniqueStatus(selectedRows));
    }
  }, [rows, selectedJobRunIds]);

  useEffect(() => {
    if (selectedAction) {
      setLoadingState({ [selectedAction]: isUpdating });
    }
  }, [isUpdating, selectedAction]);

  const updateStatusApi = useCallback(
    async (status: JOB_ACTION_STATUS_ENUM) => {
      setSelectedAction(status);
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
    loadingState,
  };
};
