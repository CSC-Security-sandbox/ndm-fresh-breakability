import { ReactNode } from "react";

export type TableWrapperWithoutFilterPropsType = {
  tableState: any;
  rowMenu?: any;
  isLoading?: any;
  content?: ReactNode;
  showDownload?: boolean;
  label?: string;
  isTogglingColumns?: boolean;
  originalColumns?: any;
  isRowDisabled?: (arg: any) => void;
  handleSelection?: (arg: any[]) => void;
  showMenu?: boolean;
  isRefreshing?: boolean;
  refetchTableData?: () => void;
};
