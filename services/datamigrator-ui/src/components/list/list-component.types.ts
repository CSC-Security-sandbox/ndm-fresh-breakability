import { ReactNode } from "react";

export type ListComponentPropsType = {
  itemsList: {
    label?: string;
    value: string | number;
    children?: ReactNode;
    tooltip?: string;
  }[];
};
