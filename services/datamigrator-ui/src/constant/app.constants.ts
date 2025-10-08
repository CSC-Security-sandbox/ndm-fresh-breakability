/* eslint-disable */
import React from "react";
import { format } from "date-fns";
import StatusCellRenderer from "@/components/custom-cell-renderer/StatusCellRenderer";
import NameCellRenderer from "@/components/custom-cell-renderer/NameCellRenderer";

export const INITIAL_VALUE_EXCLUDE_PATH_PATTERN = `*/~snapshot/*,*/.snapshot/*`;

export const COL_DEF_FOR_USER = [
  {
    header: "Name",
    accessor: "name",
    id: "column_full_name",
    width: 200,
    Renderer: NameCellRenderer,
  },
  {
    header: "First Name",
    accessor: "first_name",
    id: "column_fname",
    width: 100,
  },
  {
    header: "Last Name",
    accessor: "last_name",
    id: "column_lname",
    width: 100,
  },
  {
    header: "Email",
    accessor: "email",
    id: "column_email",
    width: 300,
  },
  {
    header: "Created On (UTC)",
    accessor: "created_at",
    Renderer: ({ value }: any) =>
      value ? format(value, "dd MMM yyyy hh:mm aa") : "",
    id: "column_created_on",
    width: 100,
  },
  {
    header: "Created By",
    accessor: "created_by.email",
    id: "column_created_by",
    width: 100,
  },
  {
    header: "Status",
    accessor: "user_status",
    id: "column_status",
    width: 100,
    Renderer: ({ value }: any) =>
      React.createElement(StatusCellRenderer, {
        status: value === "active" ? "Active" : "Inactive",
        active: value === "active",
      }),
  },
];

export const COL_DEF_FOR_PROJECT = [
  {
    header: "Name",
    accessor: "project_name",
    id: "column_project_name",
    width: 100,
  },
  {
    header: "Description",
    accessor: "project_description",
    id: "column_description",
    width: 300,
    sort: {
      enabled: false,
    },
  },
  {
    header: "Created On (UTC)",
    accessor: "created_at",
    id: "column_project_created_at",
    width: 100,
    Renderer: ({ value }: any) =>
      value ? format(value, "dd MMM yyyy hh:mm aa") : "",
  },
  {
    header: "Created By",
    id: "column_project_created_by",
    width: 100,
    accessor: "created_by.email",
  },
];

export const WORKER_SCRIPT_PATH = "/opt/datamigrator/bin/worker_register.sh";
