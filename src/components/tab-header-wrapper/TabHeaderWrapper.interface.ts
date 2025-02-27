import { ReactNode } from "react";

export interface BlueXpTabHeaderPropsType {
  tabLabel: ReactNode;
  tabIcon: ReactNode;
  tabLinks: TabLinks[];
}

export interface TabLinks {
  id?: number;
  path: string;
  label: string;
  isActive?: boolean;
}

export type HeaderType = {
  [key: string]: BlueXpTabHeaderPropsType;
};
