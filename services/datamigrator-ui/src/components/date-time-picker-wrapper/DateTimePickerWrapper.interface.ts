import { bulkDiscoveryFormType } from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/bulk-discovery.interface";
import { BlueXpFormType } from "@/types/app.type";
import { Dayjs } from "dayjs";

export interface DateTimePickerWrapperPropsType {
  bulkDiscoveryForm?: BlueXpFormType<bulkDiscoveryFormType>;
  value?: Dayjs;
  onChange?: (newValue: Dayjs | null) => void;
  errorMessage?: string;
  timezone?: string;
  format?: string;
  disablePast?: boolean;
  timeSteps?: { minutes?: number; hours?: number; seconds?: number };
}

export interface FormErrors {
  firstRunAt?: string;
}
