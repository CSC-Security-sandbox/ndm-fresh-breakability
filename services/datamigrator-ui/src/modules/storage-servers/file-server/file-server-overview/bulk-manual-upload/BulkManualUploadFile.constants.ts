import * as Yup from "yup";

export const INITIAL_VALUE_FORM = { exportPathSource: "" };

export const VALIDATION_SCHEMA = Yup.object().shape({
  exportPathSource: Yup.object().shape({
    contents: Yup.string(),
    fileName: Yup.string().matches(/^.*\.csv$/, "Only CSV file is supported."),
    fileSize: Yup.number(),
  }),
});
