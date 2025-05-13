import * as Yup from "yup";

export const CREATE_USER_FORM_VALIDATION_SCHEMA = Yup.object().shape({

  email: Yup.string()
    .matches(
      /^[a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)*@[a-zA-Z0-9]+(?:-?[a-zA-Z0-9]+)*\.[a-zA-Z]{2,}$/,
      "Enter a valid email"
    )
    .required("Email is required"),
  first_name: Yup.string().required("First Name is required"),
  last_name: Yup.string().required("Last Name is required"),
  is_app_admin: Yup.boolean(),
});

// Types
export type RoleApiType = {
  role_name: string;
  id: string;
}[];

export const DEFAULT_COLUMN_STATE  = {
  column_fname: { isHidden: true },
  column_lname: { isHidden: true },
};
