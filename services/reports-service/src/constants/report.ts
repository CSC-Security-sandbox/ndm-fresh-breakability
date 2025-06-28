import { ReportValueType } from "./enums";
export const PDFReportHeaders = {
  DISCOVER: [
    "File Server Info",
    "Number of Files",
    "Modified",
    "Created",
    "Access Time",
    "Depth",
    "Space Used",
    "File System Stats",
    "Maximum Values",
    "Job Run Stats",
    "Biggest",
  ],
};
export const ReportSubCategoriesHeader = {
  "Number of Files": [
    "File Count with File Size: 0B",
    "File Count with File Size: <8KiB",
    "File Count with File Size: 8-64KiB",
    "File Count with File Size: 64KiB-1MiB",
    "File Count with File Size: 1-10MiB",
    "File Count with File Size: 10-100MiB",
    "File Size: 100 MiB - 1 GiB",
    "File Size: 1+ GiB",
  ],
  "Space Used": [
    "Capacity with File Size: 0B",
    "Capacity with File Size: <8KiB",
    "Capacity with File Size: 8-64KiB",
    "Capacity with File Size: 64KiB-1MiB",
    "Capacity with File Size: 1-10MiB",
    "Capacity with File Size: 10-100MiB",
    "Capacity with File Size: 100 MiB - 1 GiB",
    "Capacity with File Size: 1+ GiB",
  ],
};
export interface ReportEntry {
  category: string;
  sub_category?: string;
  value: number | string;
  valueType: ReportValueType;
}
