import * as Yup from "yup";

export const CREATE_SMTP_FORM_VALIDATION_SCHEMA = Yup.object().shape({
  ip_address: Yup.string().required("IP Address is required"),
  port: Yup.number().required("Port is required"),
  user_name: Yup.string().required("User Name is required"),
  password: Yup.string().required("Password is required"),
  from_email: Yup.string()
    .email("Enter a valid email")
    .required("From Email is required"),
  to_email: Yup.array()
    .min(1, "Pick at least one item")
    .of(
      Yup.object().shape({
        value: Yup.string().required().email("Enter a valid email"),
      })
    ),
});

export const initialSMTPFormState = {
  ip_address: "",
  port: "",
  user_name: "",
  password: "",
  from_email: "",
  to_email: [],
};