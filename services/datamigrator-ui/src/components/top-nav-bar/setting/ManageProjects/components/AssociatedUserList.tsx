/* eslint-disable */
import { SubTable, useTable } from "@netapp/bxp-design-system-react";
import { getAssoicatedUserColumns } from "@components/top-nav-bar/setting/ManageProjects/components/AssociateUsers.constant";
import { useSelector } from "react-redux";
import { RootStateType } from "@store/store";

const AssociatedUsers = ({
  tableRows,
  removeUserAction,
}: {
  tableRows: any;
  removeUserAction: Function;
}) => {
  const permission = useSelector(
    (state: RootStateType) => state.permissionSlice
  );

  const { organizedRows, columns } = useTable({
    columns: getAssoicatedUserColumns(
      removeUserAction,
      permission?.userPermissions?.id
    ),
    rows: tableRows,
    pageSize: 10,
  });

  return <SubTable columns={columns} rows={organizedRows} />;
};

export default AssociatedUsers;
