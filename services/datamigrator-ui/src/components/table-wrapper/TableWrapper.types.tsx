import { ReactNode } from "react";

// Custom pagination for hierarchical data (e.g., Dell Isilon parent/child grouping)
// Allows pagination based on top-level entries while displaying expanded children inline
export type CustomPaginationType = {
  pageRows: any[];           // Rows to display in the table (includes expanded children)
  topLevelPageRows: any[];   // Top-level entries on current page (for counter: "1-10")
  totalTopLevelRows: any[];  // All top-level entries (for counter: "of 18")
  pageIndex: number;
  pageCount: number;
  gotoPage: (pageIndex: number) => void;
};

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
  secondaryLabel?: string | ReactNode;
  isRefreshing?: boolean;
  refetchTableData?: () => void;
  notReachableExportPaths?: string[];
  noDataLabel?: string;
  showSearch?: boolean;
  showRefresh?: boolean;
  showPagination?: boolean;
  customPagination?: CustomPaginationType;
};
