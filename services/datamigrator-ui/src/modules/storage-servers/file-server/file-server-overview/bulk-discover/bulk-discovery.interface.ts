import { BlueXpFormType, ConfigListTypeApiType } from "@/types/app.type";
import { Dayjs } from "dayjs";
import { OptionType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";

export interface bulkDiscoveryFormType {
  excludeFilePatterns: string;
  scheduleTime: string;
  firstRunAt: Dayjs;
  protocol: OptionType;
  shouldScanADS: string;
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
