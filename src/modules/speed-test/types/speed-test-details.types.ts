import { SpeedTestType } from "@modules/speed-test/types/speed-test.types";

export type SpeedDataType = {
  timeStamp: number;
  speed: number;
};

export type WorkerType = SpeedTestMenuPropsType & {
  workerName: string;
  workerId: string;
  readSpeed: SpeedDataType[];
  writeSpeed: SpeedDataType[];
};

export type SpeedTestMenuPropsType = {
  rtd: number;
  packetLoss: number;
};

export type SpeedOfWorkersPropsType = {
  workerName: string;
  averageSpeed: string;
};

export type LineGraphWrapperPropsType = {
  timeStamp: string[];
  graphData: number[][];
  workerLegends: SpeedOfWorkersPropsType[];
};

export type SpeedTestPropsType = SpeedActionType & {
  id: number;
  fileServerName: string;
  workers: WorkerType[];
  protocol: string;
  rtdNetwork: string;
  packetLoss: string;
};

export type SpeedTestTableType = {
  id: number;
  graphCategories: string[];
  graphData: any;
};

export type SpeedDetailsType = {
  jobRunId: string;
  startTime: string;
  endTime: string;
  noOfFileServers: number;
  status: string;
  timeElapsed: string;
  totalWorkers: number;
};

export type UseSpeedTestTableDataPropsType = {
  tableState: any;
  rowSelections: { [key: string]: number };
  handleChange: (rowId: number, selected: any) => void;
  onRowClick: (row: SpeedTestTableType) => void;
  timeStamp: string[];
  setTimestamp: React.Dispatch<React.SetStateAction<string[]>>;
  graphData: number[][];
  SetGraphData: React.Dispatch<React.SetStateAction<number[][]>>;
  workerLegends: SpeedOfWorkersPropsType[];
  SetWorkerLegends: React.Dispatch<
    React.SetStateAction<SpeedOfWorkersPropsType[]>
  >;
  speedDetails: SpeedDetailsType;
};

export type RowStateType = {
  isExpanded: boolean;
};

export type WorkerLegendsWrapperPropsType = {
  workerLegends: SpeedOfWorkersPropsType[];
  colors: string[];
};

export type CalculateAveragePropsType = {
  worker: WorkerType;
  speedAction: string;
};

export type WorkerSpeedActionPropsType = {
  workers: WorkerType[];
  speedAction: string;
};

export type SpeedActionType = {
  readSpeed: string;
  writeSpeed: string;
};

export type CalculateSpeedPropsType = {
  workers: WorkerType[];
  type: keyof SpeedTestMenuPropsType;
};

export type SpeedTestDetailsType = SpeedTestType & {
  fileServers: string[];
  totalWorkers: number;
};
