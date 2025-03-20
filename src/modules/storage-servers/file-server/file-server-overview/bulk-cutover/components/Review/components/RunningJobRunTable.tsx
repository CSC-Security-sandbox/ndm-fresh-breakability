import TableWrapperWithoutFilter from "@components/table-wrapper/TableWrapperWithoutFilter";
import { Box } from "@mui/material";
import { useContext } from "react";
import { BulkCutOverContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/context/BulkCutOverContextProvider";
import { REVIEW_WARNING_MESSAGE } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/SelectPath/selectPath.constant";
import UserWarning from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/UserWarning";
import ActionButtons from "./ActionButtons";
import useRTKApiRefresh from "@hooks/useRTKApiRefresh";
import { jobsApi } from "@api/jobsApi";

const RunningJobRunTable = () => {
  const {
    BulkCutOverForm,
    jobRunList,
    jobRunListPathTableState,
    reviewStepSelectedIds,
    setReviewStepSelectedIds,
    isFetching = false,
  } = useContext(BulkCutOverContext);
  
  const refreshRunningJobsList = useRTKApiRefresh({api: jobsApi, tag: 'ALL_JOB_RUNS'});

  return (
    <Box className="px-8 mt-3">
      <ActionButtons selectedRowIds={reviewStepSelectedIds} rows={jobRunList} />

      <TableWrapperWithoutFilter
        tableState={jobRunListPathTableState}
        label="Ongoing Job Runs"
        handleSelection={setReviewStepSelectedIds}
        refreshFunc={refreshRunningJobsList}
        isRefreshing={isFetching}
      />


      {jobRunList?.length > 0 && (
        <UserWarning
          form={BulkCutOverForm}
          controlName="isReviewConformed"
          warningMessage={REVIEW_WARNING_MESSAGE}
        />
      )}
    </Box>
  );
};

export default RunningJobRunTable;
