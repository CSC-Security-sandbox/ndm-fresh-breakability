export type TaskFiltersType = {
  columnsToFilter?: {
    accessor: string;
    label: string;
    options: string[];
    formatter?: Function;
  }[];
  setFilters?: Function;
  preSelectedFilter?: any;
};

export type TaskFilterOption = { value: string; label: string };
