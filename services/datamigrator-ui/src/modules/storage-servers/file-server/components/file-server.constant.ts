import * as Yup from "yup";
import NFSStatusRenderer from "@modules/storage-servers/file-server/components/steps/ValidateConnection/components/NFSStatusRenderer";
import StatusCellRenderer from "@components/custom-cell-renderer/StatusCellRenderer";
import { BlueXpTableRowType } from "@/types/app.type";
import React, { useContext } from "react";
import ToggleWorker from "@modules/storage-servers/file-server/components/cellRenderer/ToggleWorkerCellRenderer";
import SMBStatusRenderer from "@modules/storage-servers/file-server/components/steps/ValidateConnection/components/SMBStatusRenderer";
import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";

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
  userName: Yup.string()
    .required("SMB Username is required"),
  password: Yup.string().required("SMB Password is required"),
  protocolVersion: Yup.object({
    label: Yup.string(),
    value: Yup.string(),
  }).optional(),
  adServerIp: Yup.string().required("AD Server IP is required"),
  protocol: Yup.string()
    .oneOf(["SMB"], "Invalid protocol selected")
    .required("Protocol selection is required"),
  exportPathSource: Yup.string()
    .oneOf(Object.values(EXPORT_PATH_SOURCE_ENUM), "Invalid selection.")
    .required("Export Path Source is required."), // Required for shared schema compatibility with NFS
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
    header: "Connection Status",
    accessor: "",
    id: 4,
    Renderer: (props: BlueXpTableRowType<any, string>) => {
      // Show the appropriate status renderer based on context
      const { selectedProtocol } = useContext(CommonFileServerContext);
      if (selectedProtocol === 'NFS') {
        return React.createElement(NFSStatusRenderer, props);
      } else if (selectedProtocol === 'SMB') {
        return React.createElement(SMBStatusRenderer, props);
      }
      return "-";
    },
  },
  {
    header: "Associated",
    accessor: "id",
    id: 5,
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
  adServerIp: "",
  exportPathSource: EXPORT_PATH_SOURCE_ENUM.AUTO_DISCOVER, // Required for unified schema
};

export const INITIAL_VALUE_NFS_CREDENTIALS_FORM = {
  userName: "",
  password: "",
  protocol: "NFS",
  protocolVersion: {
    label: "v3",
    value: "v3",
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

// Dell Isilon Management Console Form
export const INITIAL_VALUE_MANAGEMENT_CONSOLE_FORM = {
  managementHost: "",
  managementUsername: "",
  managementPassword: "",
};

export const MANAGEMENT_CONSOLE_VALIDATION_SCHEMA = Yup.object().shape({
  managementHost: Yup.string().required("Management Host is required"),
  managementUsername: Yup.string().required("Username is required"),
  managementPassword: Yup.string().required("Password is required"),
});
