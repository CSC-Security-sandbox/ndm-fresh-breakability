import { registerAs } from '@nestjs/config';

export default registerAs(
  'support-bundle',
  (): Record<string, any> => ({
    bundle: {
      baseLogPath:
        process.env.BASE_LOG_PATH ||
        '/private/tmp/ndm_logs',
      outputZipPath:
        process.env.OUTPUT_ZIP_PATH ||
        '/private/tmp/generated_zips',
    },
    api: {
      configUrl: process.env.CONFIG_BASE_URL || 'http://localhost:3009/api/v1',
    },
    prometheus: {
      baseUrl:
        process.env.PROMETHEUS_BASE_URL || 'http://localhost:52061/api/v1',
      timeout: parseInt(process.env.PROMETHEUS_TIMEOUT || '30000', 10),
    },
  }),
);
