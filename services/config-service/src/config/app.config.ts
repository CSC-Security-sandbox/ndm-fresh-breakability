import { registerAs } from '@nestjs/config';

export default registerAs(
  'app',
  (): Record<string, any> => ({
    http: {
      host: process.env.APP_HOST || '0.0.0.0',
      port: parseInt(process.env.APP_PORT) || 3000,
    },
    feature: {
      enableVersionFetch: process.env.ENABLE_VERSIONS_FETCH === 'true' || false,
      enablePreListPath: process.env.ENABLE_PRE_LIST_PATH === 'true' || false,
    },
    email: {
      sendMail: process.env.SEND_EMAIL || 'http://localhost:3001',
    },
    worker: {
      healthCheckStatusTimout:
        parseInt(process.env.HEALTHCHECK_STATUS_TIMEOUT_SEC) || 60,
    },
    options: {
      jsonPayloadLimit: process.env.JSON_PAYLOAD_LIMIT || '5mb'
    },
    bundle: {
      bundleOutputPath:
        process.env.BUNDLE_OUTPUT_PATH || '/private/tmp/ndm-logs',
      prometheusBaseUrl:
        process.env.PROMETHEUS_BASE_URL ||
        'http://prometheus-server.prometheus.svc.cluster.local:80/api/v1/query',
    },
    reports: {
      supportBundleSendUrl:
        process.env.SUPPORT_BUNDLE_SEND_URL ||
        'http://reports-service-service:3000/api/v1/report/asup/support-bundle/send',
    },
  }),
);
