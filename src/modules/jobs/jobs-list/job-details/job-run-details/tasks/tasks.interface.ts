export type TaskFiltersType = {
  columnsToFilter?: {
    accessor: string;
    label: string;
    options: string[];
    formater?: Function;
  }[];
  setFilters?: Function;
  preSelectedFilter?: any;
};

export type TaskFilterOption = { value: string; label: string };
