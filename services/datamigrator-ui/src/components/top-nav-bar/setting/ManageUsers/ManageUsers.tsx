import Box from "@/components/container/Box";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import { notify } from "@components/notification/NotificationWrapper";
import {
  useGetAllUserByProjectQuery,
  useResetPasswordMutation,
  useUpdateUserStatusMutation,
} from "@api/userApi";
import { COL_DEF_FOR_USER } from "@/constant/app.constants";
import { Collapse } from "@mui/material";
import { Button } from "@netapp/bxp-design-system-react";
import { useState } from "react";
import CreateUserForm from "@components/top-nav-bar/setting/ManageUsers/CreateUserForm";
import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { hasPermission } from "@/auth/auth.utils";
import { useSelector } from "react-redux";
import { RootStateType } from "@store/store";
import { DEFAULT_COLUMN_STATE } from "@components/top-nav-bar/setting/ManageUsers/ManageUsers.constant";
import { decryptData } from "@/utils/common.utils";
import useSelectedProjectId from "@hooks/useSelectedProjectId";

const ManageUsers = () => {
  const [updateUserStatus] = useUpdateUserStatusMutation();
  const [resetPasswordApi] = useResetPasswordMutation();
  const projectId = useSelectedProjectId();
  const {
    data: userData,
    isLoading,
    isFetching,
    refetch,
  } = useGetAllUserByProjectQuery({ projectId: projectId.selectedProjectId });
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const permission = useSelector(
    (state: RootStateType) => state.permissionSlice
  );
  const [isCreateFormVisible, setIsCreateFormVisible] =
    useState<boolean>(false);

  const updateUserStatusWrapper = (body: {
    email: string;
    enable: boolean;
  }) => {
    updateUserStatus(body)
      .unwrap()
      .then((res) => {
        notify.success(res?.message);
      })
      .catch((err) => {
        console.error("error", err);
        notify.error(
          err?.error || err?.message || "Failed to update user status"
        );
      });
  };

  const canManageUser: boolean = hasPermission(
    USER_PERMISSION_TYPE_ENUM.CreateUser
  );
  const rowMenu = (row: any) => [
    {
      label: row.user_status === "active" ? "Disable Access" : "Enable Access",
      onClick: () => {
        const body = {
          email: row.email,
          enable: row.user_status !== "active",
        };
        updateUserStatusWrapper(body);
      },

      disabled: permission?.userPermissions?.id === row.id || !canManageUser,
    },
    {
      label: "Reset Password",
      disabled: row.user_status !== "active" || !canManageUser,
      onClick: () => {
        const body = {
          email: row.email,
        };
        resetPasswordApi(body)
          .unwrap()
          .then(async (res) => {
            setIsCreateFormVisible(true);
            setTemporaryPassword(await decryptData(res?.newPassword));
          })
          .catch((err) => {
            notify.error(err.message);
            console.error({ err, level: "Generate Temporary Password." });
          });
      },
    },
  ];

  const handleClose = () => {
    setIsCreateFormVisible(false);
    setTemporaryPassword("");
  };
  const tableStateProps = {
    columns: COL_DEF_FOR_USER,
    rows: userData || [],
    isSorting: true,
    pageSize: 10,
    defaultColumnState: DEFAULT_COLUMN_STATE,
    defaultSortState: { sortOrder: "desc", column: "column_created_on" },
  };

  return (
    <Box className="h-[43.75rem] w-full p-6">
      <Collapse in={isCreateFormVisible} mountOnEnter unmountOnExit>
        <Box className="flex justify-around">
          <CreateUserForm
            closeAction={handleClose}
            temporaryPassword={temporaryPassword}
          />
        </Box>
      </Collapse>
      <Collapse in={!isCreateFormVisible}>
        <TableWrapper
          tableStateProps={tableStateProps}
          isLoading={isLoading}
          rowMenu={rowMenu}
          label="Users"
          content={
            <PermissionAuth
              permissionName={USER_PERMISSION_TYPE_ENUM.CreateUser}
            >
              <Button onClick={() => setIsCreateFormVisible(true)}>
                Add User
              </Button>
            </PermissionAuth>
          }
          originalColumns={COL_DEF_FOR_USER}
          refetchTableData={refetch}
          isRefreshing={isFetching}
        />
      </Collapse>
    </Box>
  );
};

export default ManageUsers;
