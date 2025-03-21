import { Box } from "@components/container/index";
import { useTable, Button } from "@netapp/bxp-design-system-react";
import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { SPEED_TEST_COLUMN_DEF } from "@modules/speed-test/constants/speed-test.constants";
import TableWrapperWithoutFilter from "@components/table-wrapper/TableWrapperWithoutFilter";
import useSelectedProjectId from "@/hooks/useSelectedProjectId";
import { useGetSpeedTestJobsQuery } from "@api/jobsApi";
import { useNavigate } from "react-router-dom";
import { JOB_STATUS_TYPE_ENUM } from "@/types/app.type";
import useAdhocRun from "@hooks/useAdhocRun";

const SpeedTest = () => {
  const navigate = useNavigate();
  const adhocRun = useAdhocRun();
  const { selectedProjectId } = useSelectedProjectId();
  const { data: speedTestJobRunList, isLoading, isFetching, refetch } = useGetSpeedTestJobsQuery({
    projectId: selectedProjectId,
  });

  const jobStatus =
    JOB_STATUS_TYPE_ENUM.COMPLETED ||
    JOB_STATUS_TYPE_ENUM.ERRORED ||
    JOB_STATUS_TYPE_ENUM.STOPPED;

  const tableState = useTable({
    columns: SPEED_TEST_COLUMN_DEF,
    rows: speedTestJobRunList,
    isSorting: true,
    pageSize: 10,
  });

  const rowMenu = (row: any) => [
    {
      label: "Details",
      disabled: row.status !== JOB_STATUS_TYPE_ENUM.COMPLETED,
      onClick: () => {
        navigate(`/speed-test/${row.jobRunId}`);
      },
    },
    {
      label: "Adhoc Run",
      disabled: row.status !== jobStatus,
      onClick: () => adhocRun(row.jobConfigId, true),
    },
  ];

  const ADD_NEW_SPEED_TEST = (
    <PermissionAuth permissionName={USER_PERMISSION_TYPE_ENUM.ManageJob}>
      <Button className="ml-4" onClick={() => navigate("/speed-test/config")}>
        Start Speed Test
      </Button>
    </PermissionAuth>
  );

  return (
    <Box className="w-full p-6">
      <TableWrapperWithoutFilter
        tableState={tableState}
        isLoading={isLoading}
        rowMenu={rowMenu}
        content={ADD_NEW_SPEED_TEST}
        label="Job Run Listing"
        refreshFunc={refetch}
        isRefreshing={isFetching}
      />
    </Box>
  );
};

export default SpeedTest;
