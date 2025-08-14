export interface SupportBundleConfig {
  bundle: {
    baseLogPath: string;
    outputZipPath: string;
  };
  api: {
    configUrl: string;
  };
  prometheus: {
    baseUrl: string;
    timeout: number;
  };
}
