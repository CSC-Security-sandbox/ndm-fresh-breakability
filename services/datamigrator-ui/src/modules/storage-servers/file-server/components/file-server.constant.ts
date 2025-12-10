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
    .required("Export Path Source is required."), // Required for shared schema compatibility with NFS
});

export const ISILON_CREDENTIALS_VALIDATION_SCHEMA = Yup.object().shape({
  useStorageAPI: Yup.boolean().required("Use Storage API flag is required"),
  apiEndpoint: Yup.string().when("useStorageAPI", {
    is: true,
    then: (schema) => schema.required("API Endpoint is required when OneFS API is enabled"),
    otherwise: (schema) => schema.notRequired(),
  }),
  apiUsername: Yup.string().when("useStorageAPI", {
    is: true,
    then: (schema) => schema.required("API Username is required when OneFS API is enabled"),
    otherwise: (schema) => schema.notRequired(),
  }),
  apiPassword: Yup.string().when("useStorageAPI", {
    is: true,
    then: (schema) => schema.required("API Password is required when OneFS API is enabled"),
    otherwise: (schema) => schema.notRequired(),
  }),
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
  exportPathSource: EXPORT_PATH_SOURCE_ENUM.AUTO_DISCOVER, // Required for unified schema
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

export const INITIAL_VALUE_ISILON_CREDENTIALS_FORM = {
  useStorageAPI: false,
  apiEndpoint: "",
  apiUsername: "",
  apiPassword: "",
};

export const INITIAL_VALUE_JOB_CONFIG = {
  pathId: {
    value: "",
    label: "",
  },
  pathName: "",
  workingDirectory: "",
};
