import { JOB_STATUS_TYPE_ENUM } from "@/types/app.type";

export type OptionsType = {
  label: string;
  value: string;
  disabled?: boolean | undefined;
};

export type SpeedTestConfigurationType = {
  id: number;
  fileServer: OptionsType;
  protocol: OptionsType[];
  workers: OptionsType[];
  tests: OptionsType[];
};

export type DetailsTilePropsType = {
  title: string;
  value: string | number;
  startTime: string;
  endTime: string;
};

export type SpeedTestDetailsStatusRendererPropsType = {
  status: string | number;
};

export type SubRowRendererPropsType = {
  row: any;
  rowSelections: { [key: string]: number };
  handleChange: (rowId: number, selected: any) => void;
};

export type SpeedTestType = {
  jobRunId: string;
  startTime: string;
  endTime: string;
  workers: number;
  status: JOB_STATUS_TYPE_ENUM;
};

export type SpeedTestJobsType = SpeedTestType & {
  fileServers: number;
};

export type TransformedDataPropsType = {
  speedTestConfigurationData: SpeedTestConfigurationType[];
  projectId: string;
};

export type SpeedTestConfigType = {
  id: string;
  serverName: string;
  hasScratchPath: boolean;
  status: string;
  fileServers: {
    id: string;
    protocol: string;
    workers: {
      id: string;
      workerName: string;
    }[];
  }[];
};

export type ConfigDetailsType = {
  id: string;
  protocol: OptionsType[];
  workers: OptionsType[];
};

export type ItemType = {
  protocol: OptionsType[];
  fileServer: OptionsType;
};

export type DataCellRendererPropsType = {
  value: number;
  unit: string;
};

export type TestType = { value: string };
