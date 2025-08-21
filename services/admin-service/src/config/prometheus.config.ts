import { registerAs } from '@nestjs/config';

export type PrometheusConfig = {
  prometheusBaseIp: string;
};

export default registerAs(
  'prometheusConfig',
  (): PrometheusConfig => ({
    prometheusBaseIp: process.env.PROMETHEUS_BASE_URL || 'localhost',
  }),
);
