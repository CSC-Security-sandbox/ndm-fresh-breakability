export interface WorkerVersionInfo {
  workerName: string;
  ipAddress: string;
  platform: string;
}

export interface AboutNdmResponse {
  product: {
    name: string | null;
    version: string | null;
    serialId: string | null;
  };
  build: {
    worker_version: {
      version: string | null;
      time: string | null;
    };
    controlPlane_version: {
      version: string | null;
      time: string | null;
    };
    workersByVersion?: Record<string, WorkerVersionInfo[]>;
  };
  contact: {
    email: string | null;
    phone: string | null;
    website: string | null;
  };
}
