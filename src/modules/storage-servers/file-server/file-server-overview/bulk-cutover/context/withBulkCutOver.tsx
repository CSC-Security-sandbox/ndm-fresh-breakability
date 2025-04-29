import {
  BlueXpFormType,
  BlueXpTableStateType,
  GetAllCutOverPathsApiType,
  JOB_STATUS_TYPE_ENUM,
  JobRunApiType,
} from "@/types/app.type";
import { useLazyGetAllCutOverPathsQuery } from "@api/configApi";
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

const INIT_VALUE: bulkCutOverFormType = {
  isReviewConformed: false,
  isSelectPathConformed: false,
};

export function withBulkCutOver(WrappedComponent: ComponentType<any>) {
  return function WithBulkCutOverComponent(props: any) {
    const navigate = useNavigate();
    const [jobRunList, setJobRunList] = useState<JobRunApiType[]>([]);
    const [cutOverSelectedIds, setCutOverSelectedIds] = useState<string[]>([]);
    const [reviewStepSelectedIds, setReviewStepSelectedIds] = useState<
      string[]
    >([]);

    // API CALLS
    const [createJobCutOverApi, { isLoading: isSubmittingBulkCutover }] =
      useBulkCutOverMutation();
    const { selectedProjectId: projectId } = useSelectedProjectId();
    const {
      data: jobRunListData,
      isFetching,
      refetch,
    } = useGetJobRunsQuery({
      projectId,
    });
    const { fileServerDetails } = useFileServerDetails();
    const [getAllCutOverPathsApi] = useLazyGetAllCutOverPathsQuery();
    const [allCutOverPaths, setAllCutOverPaths] = useState<
      GetAllCutOverPathsApiType[]
    >([]);

    // GET ALL MIGRATION PATHS (STEP 1
    useEffect(() => {
      if (!fileServerDetails?.id) return;
      (async () => {
        try {
          const _allCutOverPaths: GetAllCutOverPathsApiType[] =
            await getAllCutOverPathsApi({
              fileServerId: fileServerDetails?.id,
            }).unwrap();

          setAllCutOverPaths(_allCutOverPaths);
        } catch (error) {
          console.error(error);
        }
      })();
    }, [fileServerDetails]);

    const getRunningStatusJobRunId = () => {
      const _JobRunListWithId = jobRunListData
        .map((jobRun) => ({
          ...jobRun,
          id: jobRun.jobRunId,
        }))
        .filter((jobRun) => jobRun.status === JOB_STATUS_TYPE_ENUM.RUNNING);
      setJobRunList(_JobRunListWithId);
    };

    useEffect(() => {
      if (!jobRunListData) return;
      getRunningStatusJobRunId();
    }, [jobRunListData]);

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
        notify.error("Something went wrong.");
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
    };
    return <WrappedComponent {...props} {...bulkCutOverHelpers} />;
  };
}
