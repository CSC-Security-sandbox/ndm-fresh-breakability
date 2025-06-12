import { ReactNode } from "react";

export type ListComponentPropsType = {
  itemsList: {
    label?: string;
    value: string | number;
    extraContent?: ReactNode;
    tooltip?: string;
  }[];
};
