import { BlueXpFormType, ConfigListTypeApiType } from "@/types/app.type";
import { Dayjs } from "dayjs";

export interface bulkDiscoveryFormType {
  excludeFilePatterns: string;
  scheduleTime: string;
  firstRunAt: Dayjs;
}

export interface TopSectionPropsType {
  fileServerDetails: ConfigListTypeApiType;
  bulkDiscoveryForm: BlueXpFormType<bulkDiscoveryFormType>;
}

export interface ScheduleComponentType {
  bulkDiscoveryForm: BlueXpFormType<bulkDiscoveryFormType>;
}

export interface BulkDiscoveryFooterType {
  bulkDiscoveryForm: BlueXpFormType<bulkDiscoveryFormType>;
  selectedExportPathsIds: string[];
  handleCreateBulkDiscovery: () => void;
  isSubmitting: boolean;
}
