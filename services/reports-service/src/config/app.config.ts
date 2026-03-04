import { registerAs } from "@nestjs/config";

export default registerAs(
  "app",
  (): Record<string, any> => ({
    http: {
      host: process.env.APP_HOST || "0.0.0.0",
      port: parseInt(process.env.APP_PORT) || 3000,
    },
    baseDir: process.env.REPORT_DOWNLOAD_LOCATION || "/reports",
    asup: {
      asupEndpoint: process.env.ASUP_ENDPOINT || "https://eprod.netapp.com/put/AsupPut",
    },
  }),
);
