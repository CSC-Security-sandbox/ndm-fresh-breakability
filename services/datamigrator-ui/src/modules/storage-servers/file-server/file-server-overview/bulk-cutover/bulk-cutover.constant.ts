import Review from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/Review/Review";
import SelectPath from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/SelectPath/SelectPath";

export const CUT_OVER_STEPS_MAP = {
  "select-path": SelectPath,
  review: Review,
};

export const CUT_OVER_STEPS_PATHS = {
  default: [
    { label: "Select Path", key: "select-path" },
    { label: "Review", key: "review" },
  ],
};
