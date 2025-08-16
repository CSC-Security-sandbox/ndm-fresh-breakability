import { BlueXpFormType } from "@/types/app.type";

export type RadioButtonGroupPropsType = {
  options: { value: string; label: string }[];
  form: BlueXpFormType<any>;
  name: string;
  disabled?: boolean;
};
