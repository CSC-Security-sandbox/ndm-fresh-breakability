import { registerAs } from "@nestjs/config";

export default registerAs(
  "app",
  (): Record<string, any> => ({
    http: {
      host: process.env.APP_HOST || "0.0.0.0",
      port: parseInt(process.env.APP_PORT) || 3000,
    },
    rabbitmq: {
      urls: process.env.RABBITMQ_URLS?.split(",") || [],
      durable: process.env.RABBITMQ_QUEUE_IS_DURABLE || true,
      reportsQueue: process.env.REPORTS_QUEUE || "",
    },
  }),
);
