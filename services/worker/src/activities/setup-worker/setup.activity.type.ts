interface SetupOutput {
    jobRunId: string;
    status: 'success' | 'error';
    protocolType?: string;
    workerId: string;
    message: string;
    state?: any,
    jobStateUpdatedAfterWait?: any,
    jobStateUpdated?: any
  }