import { Box } from "@components/container/index";
import { useTable, Button } from "@netapp/bxp-design-system-react";
import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { SPEED_TEST_COLUMN_DEF } from "@modules/speed-test/constants/speed-test.constants";
import TableWrapperWithoutFilter from "@components/table-wrapper/TableWrapperWithoutFilter";
import useSelectedProjectId from "@/hooks/useSelectedProjectId";
import { useGetSpeedTestJobsQuery, useJobAdhocRunMutation } from "@api/jobsApi";
import { notify } from "@components/notification/NotificationWrapper";
import { useNavigate } from "react-router-dom";

const SpeedTest = () => {
  const navigate = useNavigate();
  const { selectedProjectId } = useSelectedProjectId();
  const { data: speedTestJobRunList, isLoading } = useGetSpeedTestJobsQuery({
    projectId: selectedProjectId,
  });
  const [adhocRun] = useJobAdhocRunMutation();

  const tableState = useTable({
    columns: SPEED_TEST_COLUMN_DEF,
    rows: speedTestJobRunList,
    isSorting: true,
    pageSize: 10,
  });

  const rowMenu = (row: any) => [
    {
      label: "Details",
      onClick: () => {
        navigate(`/speed-test/${row.jobRunId}`);
      },
    },
    {
      label: "Adhoc Run",
      onClick: () => {
        (async () => {
          try {
            await adhocRun({ jobConfigId: row.jobConfigId }).unwrap();
            notify.success("Successfully initiated ad-hoc run");
          } catch (err) {
            notify.error(err?.message || "Failed to initiate ad-hoc run");
          }
        })();
      },
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
    <Box className="w-full h-screen p-6">
      <TableWrapperWithoutFilter
        tableState={tableState}
        isLoading={isLoading}
        rowMenu={rowMenu}
        content={ADD_NEW_SPEED_TEST}
        label="Job Run Listing"
      />
    </Box>
  );
};

export default SpeedTest;
