import { registerAs } from '@nestjs/config';

export type PrometheusConfig = {
  prometheusBaseIp: string;
  timeout: number;
};

export default registerAs(
  'prometheusConfig',
  (): PrometheusConfig => ({
    prometheusBaseIp:
      process.env.PROMETHEUS_BASE_URL ||
      'http://prometheus-server.prometheus.svc.cluster.local:80/api/v1',
    timeout: process.env.PROMETHEUS_TIMEOUT
      ? parseInt(process.env.PROMETHEUS_TIMEOUT, 10)
      : 30000,
  }),
);
