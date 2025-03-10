import { ReactNode } from "react";

export type TableWrapperWithoutFilterPropsType = {
  tableState: any;
  rowMenu?: any;
  isLoading?: any;
  content?: ReactNode;
  showDownload?: Boolean;
  label?: string;
  isTogglingColumns?: Boolean;
  originalColumns?: any;
  isRowDisabled?: (arg: any) => void;
  handleSelection?: Function;
  showMenu?: boolean;
};
