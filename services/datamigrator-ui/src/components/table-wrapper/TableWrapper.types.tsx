import { ReactNode } from "react";

export type TableWrapperPropsType = {
  tableStateProps: any;
  rowMenu?: any;
  isLoading?: any;
  content?: ReactNode;
  showDownload?: boolean;
  label?: string;
  isTogglingColumns?: boolean;
  originalColumns?: any;
  showFilters?: boolean;
  columnsToFilter?: { accessor: string; label: string }[];
  isRowDisabled?: (arg: any) => void;
  showLabel?: boolean;
  preSelectedFilter?: any;
  handleSelection?: (arg: any[], tableRows?: any[]) => void;
  secondaryLabel?: string;
  isRefreshing?: boolean;
  refetchTableData?: () => void;
  notReachableExportPaths?: string[];
  noDataLabel?: string;
  showSearch?: boolean;
  showRefresh?: boolean;
  showPagination?: boolean;
};
