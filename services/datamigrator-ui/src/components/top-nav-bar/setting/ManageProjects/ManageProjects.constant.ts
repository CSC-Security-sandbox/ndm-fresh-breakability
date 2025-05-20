import * as Yup from "yup";

export const ASSOCIATE_USER_FORM_VALIDATION_SCHEMA = Yup.object({
  user: Yup.object({
    label: Yup.string().required("Label is required"),
    value: Yup.string().required("Value is required"),
  }).required("User is required"),
  role: Yup.object({
    label: Yup.string().required("Label is required"),
    value: Yup.string().required("Value is required"),
  }).required("Role is required"),
});

export const CREATE_PROJECT_FORM_VALIDATION_SCHEMA = Yup.object({
  project_name: Yup.string().required("Project Name is required"),
  project_description: Yup.string(),
});
