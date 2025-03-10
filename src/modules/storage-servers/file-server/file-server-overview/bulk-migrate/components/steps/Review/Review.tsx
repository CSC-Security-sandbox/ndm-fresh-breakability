import React, { useContext } from "react";
import { REVIEW_LIST_COLUMN_DEFS } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import { Box } from "@components/container/index";
import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import {
  createSelectedMountPathsObject,
  structureDataForReviewList,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";
import PreCheckErrors from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Review/PrecheckErrors";

const Review = () => {
  const {
    mappingStepForm,
    selectedReviewIds,
    setSelectedReviewIds,
    isPrecheckLoading,
    preCheckStatus,
    isPrecheckSuccessful,
    reviewIdsValidated,
  } = useContext(BulkMigrateContext);

  const rows = structureDataForReviewList(
    mappingStepForm?.values?.migrationDetailsTableConfigurationValue,
    mappingStepForm?.values?.selectedMountPathsId,
    preCheckStatus
  );

  const tableStateProps = {
    columns: REVIEW_LIST_COLUMN_DEFS,
    rows: rows?.map((row, key) => ({
      ...row,
      isSelected: selectedReviewIds?.find((data) => Number(data) === key)
        ? true
        : false,
      isValidated: reviewIdsValidated?.find((data) => Number(data) === key)
        ? true
        : false,
      isPrecheckLoading,
      isPrecheckSuccessful,
    })),
    isSorting: true,
    pageSize: 10,
    isRowSelecting: true,
    defaultSelectionState: {
      rows: createSelectedMountPathsObject(selectedReviewIds),
    },
  };

  return (
    <Box className="h-3/5 w-9/12 mx-auto">
      <PreCheckErrors errorData={rows} />
      <TableWrapper
        tableStateProps={tableStateProps}
        showLabel={false}
        handleSelection={setSelectedReviewIds}
      />
    </Box>
  );
};

export default Review;
