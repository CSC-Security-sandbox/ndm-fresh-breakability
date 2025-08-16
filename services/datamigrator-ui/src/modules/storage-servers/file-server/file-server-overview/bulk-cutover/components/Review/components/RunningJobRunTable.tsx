import TableWrapperWithoutFilter from "@components/table-wrapper/TableWrapperWithoutFilter";
import { Box } from "@mui/material";
import { memo, useContext } from "react";
import { BulkCutOverContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/context/BulkCutOverContextProvider";
import { REVIEW_WARNING_MESSAGE } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/SelectPath/selectPath.constant";
import UserWarning from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/UserWarning";
import ActionButtons from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/Review/components/ActionButtons";

const RunningJobRunTable = () => {
  const {
    BulkCutOverForm,
    jobRunList,
    jobRunListPathTableState,
    reviewStepSelectedIds,
    setReviewStepSelectedIds,
    isFetching = false,
    refetch,
  } = useContext(BulkCutOverContext);

  return (
    <Box className="mt-3">
      <TableWrapperWithoutFilter
        tableState={jobRunListPathTableState}
        label="Ongoing Job Runs"
        handleSelection={setReviewStepSelectedIds}
        refetchTableData={refetch}
        isRefreshing={isFetching}
        content={
          <ActionButtons
            selectedRowIds={reviewStepSelectedIds}
            rows={jobRunList}
          />
        }
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

export default memo(RunningJobRunTable);
