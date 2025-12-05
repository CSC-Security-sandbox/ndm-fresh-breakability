export interface OperationErrorExportData {
  id: string;
  operationId: string;
  errorCode: string;
  errorMessage: string;
  createdAt: string;
  errorType: string;
  operationType: string;
  origin: string;
  projectId: string;
  projectName: string;
}

export interface ExportRequest {
  projectIds: string[];
  startDate: string; // YYYY-MM-DD format
  endDate: string; // YYYY-MM-DD format
  outputLocation: string; // Path to the zip file (e.g., /path/to/ndm_userID.zip)
}

export interface ExportResult {
  success: boolean;
  message: string;
  filesCreated: number;
}
