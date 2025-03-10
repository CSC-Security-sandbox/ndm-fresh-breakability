import NameCellRenderer from "./components/cellRenderer/NameCellRenderer";
import NfsHostCellRenderer from "./components/cellRenderer/NfsHostCellRenderer";
import NfsUserNameCellRenderer from "./components/cellRenderer/NfsUserNameCellRenderer";
import ServerTypeCellRenderer from "./components/cellRenderer/ServerTypeCellRenderer";
import SmbHostCellRenderer from "./components/cellRenderer/SmbHostCellRenderer";
import SmbUserNameCellRenderer from "./components/cellRenderer/SmbUserNameCellRenderer";
import FileServerStatusCellRenderer from "./components/cellRenderer/FileServerStatusCellRenderer";
import Credentials from "./components/steps/Credentials/Credentials";
import JobConfig from "./components/steps/JobConfig/JobConfig";
import ServerType from "./components/steps/ServerType/ServerType";
import ValidateConnection from "./components/steps/ValidateConnection/ValidateConnection";
import DateCellRenderer from "@components/custom-cell-renderer/DateCellRenderer";
import React from "react";
import { BlueXpTableRowType, FileServerApiType } from "@/types/app.type";

export const STEPS_MAP = {
  "server-type": ServerType,
  "credentials-details": Credentials,
  "validate-connection": ValidateConnection,
  "job-config": JobConfig,
};

export const STEPS_PATHS = {
  default: [
    { label: "Server Type", key: "server-type" },
    { label: "Credentials", key: "credentials-details" },
    { label: "Workers", key: "validate-connection" },
    { label: "Job Config", key: "job-config" },
  ],
};

export const FILE_SERVER_LIST_COLUMN_DEFS: any[] = [
  {
    id: 1,
    header: "Name",
    accessor: "configName",
    Renderer: NameCellRenderer,
  },
  {
    header: "Server",
    accessor: "serverType",
    Renderer: ServerTypeCellRenderer,
    id: 2,
  },
  {
    header: "NFS User Name",
    accessor: "fileServers",
    Renderer: NfsUserNameCellRenderer,
    id: 3,
  },
  {
    header: "NFS Host",
    accessor: "fileServers",
    Renderer: NfsHostCellRenderer,
    id: 4,
  },
  {
    header: "SMB User Name",
    accessor: "fileServers",
    Renderer: SmbUserNameCellRenderer,
    id: 5,
  },
  {
    header: "SMB Host",
    accessor: "fileServers",
    Renderer: SmbHostCellRenderer,
    id: 6,
  },
  {
    header: "Status",
    accessor: "status",
    sortable: true,
    filter: true,
    Renderer: FileServerStatusCellRenderer,
    id: 7,
  },
  {
    header: "Created On",
    accessor: "createdAt",
    id: 8,
    Renderer: (
      props: BlueXpTableRowType<FileServerApiType, FileServerApiType>
    ) =>
      React.createElement(DateCellRenderer, { value: props?.row?.createdAt }),
  },
];
