/* eslint-disable */
import React from "react";
import RemoveCellRenderer from "@components/custom-cell-renderer//RemoveCellRenderer";
import {
  AssociatedUsersOptionsType,
  BlueXpTableRowType,
} from "@/types/app.type";

const getAssoicatedUserColumns = (
  removeUserAction: Function,
  loggedInUserId: string
) => [
  {
    header: "User",
    accessor: "user.label",
    id: "user",
    width: 470,
  },
  {
    header: "Role",
    accessor: "role.label",
    id: "role",
    width: 400,
  },
  {
    header: "",
    accessor: "user",
    id: "action",
    width: 20,
    Renderer: ({
      value,
    }: BlueXpTableRowType<
      AssociatedUsersOptionsType,
      AssociatedUsersOptionsType["user"]
    >) =>
      React.createElement(RemoveCellRenderer, {
        deleteRow: () => removeUserAction(value),
        disabled: loggedInUserId === value.value,
      }),
  },
];

export { getAssoicatedUserColumns };
