export type TaskFiltersType = {
  columnsToFilter?: {
    accessor: string;
    label: string;
    options: string[];
    formatter?: (value: string) => string;
  }[];
  setFilters?: (arg: any) => void;
  preSelectedFilter?: any;
};

export type TaskFilterOption = { value: string; label: string };
