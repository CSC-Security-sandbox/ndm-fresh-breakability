export type PreCheckStatusPropsType = {
  errorData: StatusType[];
};

export type StatusType = {
  status: { errors: [] };
};

export type ErrorItem = {
  sourcePathId: string;
  destinationPathId: string;
  errors: string[];
};

export type PreCheckStatus = {
  success: string[];
  failed: string[];
  errors: ErrorItem[];
  warnings: string[];
};

export type PreCheckErrorDetailsPropsType = {
  index: number;
  errorKey: string;
};

export type PreCheckErrorAccordionPropsType = {
  errorData: StatusType[];
  preCheckError: ErrorItem;
};

export type PreCheckAccordionTitlePropsType = {
  truncateSourcePath?: string;
  sourcePath?: string;
  truncateDestinationPath?: string;
  destination?: string;
  destinationPath?: string;
  errorLabel: string;
};
