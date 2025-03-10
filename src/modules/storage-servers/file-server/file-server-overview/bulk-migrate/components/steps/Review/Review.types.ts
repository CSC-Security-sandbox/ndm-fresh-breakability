export type PreCheckStatusPropsType = {
  errorData: StatusType[];
};

export type StatusType = {
  status: { errors: [] };
};

export type ErrorItem = {
  sourcePathId: string;
  errors: any[];
};

export type PreCheckStatus = {
  success: string[];
  failed: string[];
  errors: ErrorItem[];
};
