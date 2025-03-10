import Review from "./components/Review/Review";
import SelectPath from "./components/SelectPath/SelectPath";

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
