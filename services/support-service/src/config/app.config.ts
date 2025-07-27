import { registerAs } from '@nestjs/config';

export default registerAs(
  'support-bundle',
  (): Record<string, any> => ({
    bundle: {
      baseLogPath:
        process.env.BASE_LOG_PATH ||
        '/Users/aniketdarekar/Desktop/poc/ndm_logs',
      outputZipPath:
        process.env.OUTPUT_ZIP_PATH ||
        '/Users/aniketdarekar/Desktop/poc/generated-zips',
    },
  }),
);
