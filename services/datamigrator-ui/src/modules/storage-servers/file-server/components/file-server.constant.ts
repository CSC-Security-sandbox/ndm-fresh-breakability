import * as Yup from "yup";
import NFSStatusRenderer from "@modules/storage-servers/file-server/components/steps/ValidateConnection/components/NFSStatusRenderer";
import StatusCellRenderer from "@components/custom-cell-renderer/StatusCellRenderer";
import { BlueXpTableRowType } from "@/types/app.type";
import React from "react";
import ToggleWorker from "@modules/storage-servers/file-server/components/cellRenderer/ToggleWorkerCellRenderer";
import SMBStatusRenderer from "@modules/storage-servers/file-server/components/steps/ValidateConnection/components/SMBStatusRenderer";

export const SERVICE_AND_PROTOCOL_VALIDATION_SCHEMA = Yup.object({
  configName: Yup.string().required("Name is required"),
  serverType: Yup.object({
    label: Yup.string().required("Label is required"),
    value: Yup.string().required("Value is required"),
  }).required("Server Type is required"),
});

export const HOST_CREDENTIALS_VALIDATION_SCHEMA = Yup.object().shape({
  host: Yup.string().required("Hostname is required"),
});

export enum EXPORT_PATH_SOURCE_ENUM {
  AUTO_DISCOVER = "AUTO_DISCOVER",
  MANUAL_UPLOAD = "MANUAL_UPLOAD",
}

export const NFS_CREDENTIALS_VALIDATION_SCHEMA = Yup.object().shape({
  userName: Yup.string().required("NFS Username is required"),
  protocolVersion: Yup.object({
    label: Yup.string().required("Label is required"),
    value: Yup.string().required("Value is required"),
  }).required("Version is required"),
  protocol: Yup.string()
    .oneOf(["NFS"], "Invalid protocol selected")
    .required("Protocol selection is required"),
  exportPathSource: Yup.string()
    .oneOf(Object.values(EXPORT_PATH_SOURCE_ENUM), "Invalid selection.")
    .required("Export Path Source is required."),
});

export const SMB_CREDENTIALS_VALIDATION_SCHEMA = Yup.object().shape({
  userName: Yup.string().required("SMB Username is required"),
  protocolVersion: Yup.object({
    label: Yup.string().required("Label is required"),
    value: Yup.string().required("Value is required"),
  }).required("Version is required"),
  password: Yup.string().required("Password is required"),
  protocol: Yup.string()
    .oneOf(["SMB"], "Invalid protocol selected")
    .required("Protocol selection is required"),
  exportPathSource: Yup.string()
    .oneOf(Object.values(EXPORT_PATH_SOURCE_ENUM), "Invalid selection.")
    .required("Export Path Source is required."), // Required for type consistency, not used in UI
});

export const VALIDATE_CONNECTION_COLUMN_DEF: any[] = [
  {
    header: "Workers",
    accessor: "workerName",
    id: 1,
  },
  {
    header: "Address",
    accessor: "ipAddress",
    id: 2,
  },
  {
    header: "Status",
    accessor: "status",
    id: 3,
    Renderer: ({ value }: BlueXpTableRowType<any, string>) =>
      React.createElement(StatusCellRenderer, {
        status: value,
        active: value === "Online",
      }),
  },
  {
    header: "NFS",
    accessor: "",
    id: 4,
    Renderer: NFSStatusRenderer,
  },
  {
    header: "SMB",
    accessor: "",
    Renderer: SMBStatusRenderer,
    id: 5,
  },
  {
    header: "Associated",
    accessor: "id",
    id: 6,
    Renderer: (props: BlueXpTableRowType<any, string>) => {
      return React.createElement(ToggleWorker, {
        ...props,
      });
    },
  },
];

export const COLUMN_DEF_MAPPING: any[] = [
  {
    header: "Export Paths",
    accessor: "volumePath",
    id: 2,
  },
];

export const INITIAL_VALUE_SERVICE_AND_PROTOCOL_FORM = {
  configName: "",
  serverType: {
    label: "Other NAS",
    value: "OtherNAS",
  },
};

export const INITIAL_VALUE_SERVER_TYPE_FORM = { host: "" };

export const INITIAL_VALUE_SMB_CREDENTIALS_FORM = {
  userName: "",
  password: "",
  protocol: "SMB",
  protocolVersion: {
    label: "",
    value: "",
  },
  exportPathSource: EXPORT_PATH_SOURCE_ENUM.AUTO_DISCOVER, // Not used for SMB but required for type consistency
};

export const INITIAL_VALUE_NFS_CREDENTIALS_FORM = {
  userName: "",
  password: "",
  protocol: "NFS",
  protocolVersion: {
    label: "",
    value: "",
  },
  exportPathSource: EXPORT_PATH_SOURCE_ENUM.AUTO_DISCOVER,
};

export const INITIAL_VALUE_JOB_CONFIG = {
  pathId: {
    value: "",
    label: "",
  },
  pathName: "",
  workingDirectory: "",
};
