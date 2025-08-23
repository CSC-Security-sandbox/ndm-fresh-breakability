export interface AboutNdmResponse {
  product: {
    name: string | null;
    version: string | null;
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
  };
  contact: {
    email: string | null;
    phone: string | null;
    website: string | null;
  };
}
