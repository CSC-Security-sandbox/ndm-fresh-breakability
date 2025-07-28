import {
  ConfigListTypeApiType,
  VolumeType,
  WorkerApiType,
} from "@/types/app.type";

export interface ExportPathsTablePropsType {
  fileServerDetails: ConfigListTypeApiType;
  allExportPaths: VolumeType[];
  showRefetch: boolean;
  isRowSelectingEnabled?: boolean;
  setSelectedExportPathsIds: (ids: string[]) => void;
  defaultColumnState?: any;
  notReachableExportPaths: string[];
  refetch?: () => void;
  isFetching?: boolean;
  jobType?: string;
}

export interface TableRendererPropsType {
  allExportPaths: VolumeType[];
  allWorkersList: WorkerApiType[];
  fileServerDetails: ConfigListTypeApiType;
  refetch: () => void;
  isFetching: boolean;
}

export interface OverviewTabsPropsType {
  fileServerDetails: ConfigListTypeApiType;
  allExportPaths: VolumeType[];
  allWorkersList: WorkerApiType[];
  currentTab: number;
  setCurrentTab: (arg: number) => void;
}

export interface WorkersTablePropsType {
  fileServerDetails: ConfigListTypeApiType;
  showRefetch: boolean;
  allWorkersList: WorkerApiType[];
}
