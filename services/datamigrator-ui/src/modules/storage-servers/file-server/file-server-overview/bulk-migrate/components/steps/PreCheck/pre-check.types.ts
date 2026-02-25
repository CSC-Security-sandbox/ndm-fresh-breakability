export type PreCheckStatusPropsType = {
  errorData: StatusType[];
};

export type StatusType = {
  status: {
    errors: [];
    migrationConflicts?: MigrationConflictDetail[];
  };
};

export type ErrorItem = {
  sourcePathId: string;
  destinationPathId: string;
  errors: string[];
};

export type MigrationConflictDetail = {
  status: string;
  jobId: string;
  sourcePathId: string;
  targetPathId: string;
  sourceDirectoryPath?: string | null;
  targetDirectoryPath?: string | null;
  sourceServerId: string;
  targetServerId: string;
  conflictType: 'circular' | 'destination' | 'source';
  jobType: string;
};

export type MigrationConflictError = {
  status: string;
  errors: string[];
  details: MigrationConflictDetail[];
  message: string;
};

export type PreCheckStatus = {
  success: string[];
  failed: string[];
  errors: ErrorItem[];
  warnings: string[];
  migrationConflicts?: MigrationConflictDetail[];
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

export type MigrationConflictErrorPropsType = {
  conflictData: MigrationConflictDetail[];
};
