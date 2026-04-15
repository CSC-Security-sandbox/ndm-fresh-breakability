import {
  BlueXpFormType,
  BlueXpTableStateType,
  GetAllCutOverPathsApiType,
  JOB_STATUS_TYPE_ENUM,
  JobRunApiType,
} from "@/types/app.type";
import { useGetAllCutOverPathsQuery } from "@api/configApi";
import { useBulkCutOverMutation, useGetJobRunsQuery } from "@api/jobsApi";
import { notify } from "@components/notification/NotificationWrapper";
import useFileServerDetails from "@hooks/useFileServerDetails";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import {
  BulkCutOverContextProviderType,
  bulkCutOverFormType,
  CreateBulkCutOverApiPayloadType,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/bulk-cutover.interface";
import { createBulkCutOverPayload } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/bulk-cutover.utils";
import { JOB_RUN_LIST_COLUMN_DEFS_REVIEW } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/Review/review.constant";
import { SELECT_PATH_COL_DEFS } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/SelectPath/selectPath.constant";
import { useForm, useTable } from "@netapp/bxp-design-system-react";
import { ComponentType, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";

const INIT_VALUE: bulkCutOverFormType = {
  isReviewConformed: false,
  isSelectPathConformed: false,
};

export function withBulkCutOver(WrappedComponent: ComponentType<any>) {
  return function WithBulkCutOverComponent(props: any) {
    const navigate = useNavigate();
    const [cutOverSelectedIds, setCutOverSelectedIds] = useState<string[]>([]);
    const [reviewStepSelectedIds, setReviewStepSelectedIds] = useState<
      string[]
    >([]);

    // API CALLS
    const [createJobCutOverApi, { isLoading: isSubmittingBulkCutover }] =
      useBulkCutOverMutation();
    const { selectedProjectId: projectId } = useSelectedProjectId();
    const { jobRunList, refetch, isFetching, error } = useGetJobRunsQuery(
      {
        projectId,
      },
      {
        selectFromResult: ({ data, isFetching, error }) => ({
          jobRunList: data
            ?.map((jobRun) => ({
              ...jobRun,
              id: jobRun.jobRunId,
            }))
            .filter((jobRun) => jobRun.status === JOB_STATUS_TYPE_ENUM.RUNNING),
          isFetching,
          error,
        }),
      }
    );
    const { fileServerDetails, zoneFileServerId } = useFileServerDetails();
    const {
      data: allCutOverPaths = [],
      isFetching: isCutOverPathsFetching,
      refetch: refetchCutOverPaths,
      error: cutOverPathsError,
    } = useGetAllCutOverPathsQuery(
      fileServerDetails?.id 
        ? { fileServerId: fileServerDetails.id, zoneFileServerId } 
        : skipToken
    );

    useEffect(() => {
      if (error) {
        notify.error(error?.message || "Something went wrong.");
        console.error("Error while fetching job runs", error);
      }
    }, [error]);

    // SELECT PATH (STEP 1)
    const selectPathTableState: BlueXpTableStateType<GetAllCutOverPathsApiType> =
      useTable({
        columns: SELECT_PATH_COL_DEFS,
        rows: allCutOverPaths,
        isRowSelecting: true,
        isSorting: true,
        pageSize: 10,
      });

    // REVIEW (STEP 2)
    const jobRunListPathTableState: BlueXpTableStateType<JobRunApiType> =
      useTable({
        columns: JOB_RUN_LIST_COLUMN_DEFS_REVIEW,
        rows: jobRunList,
        isRowSelecting: true,
        isSorting: true,
        pageSize: 10,
        defaultSortState: { sortOrder: "desc", column: "startTime" },
      });

    // CONFORMATION FORM (BOTH STEP)
    const BulkCutOverForm: BlueXpFormType<bulkCutOverFormType> =
      useForm(INIT_VALUE);

    const handleCreateJobCutOverApi = async () => {
      try {
        const payload: CreateBulkCutOverApiPayloadType =
          createBulkCutOverPayload(cutOverSelectedIds, selectPathTableState);
        await createJobCutOverApi(payload).unwrap();
        notify.success("Bulk Cut Over Job Created Successfully");
        navigate(-1);
      } catch (error) {
        const serverMessage: string = error?.data?.message ?? "";
        notify.error(
          serverMessage || "An error occurred while creating the bulk cutover job. Please try again."
        );
        console.error("ERROR -->", error);
      }
    };

    const bulkCutOverHelpers: BulkCutOverContextProviderType = {
      BulkCutOverForm,
      jobRunList,
      cutOverSelectedIds,
      setCutOverSelectedIds,
      selectPathTableState,
      jobRunListPathTableState,
      allCutOverPaths,
      fileServerDetails,
      reviewStepSelectedIds,
      setReviewStepSelectedIds,
      handleCreateJobCutOverApi,
      isSubmittingBulkCutover,
      isFetching,
      refetch,
      isCutOverPathsFetching,
      refetchCutOverPaths,
    };
    return <WrappedComponent {...props} {...bulkCutOverHelpers} />;
  };
}
