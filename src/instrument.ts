import { NodeSDK } from '@opentelemetry/sdk-node';
// OpenTelemetry's Node.js documentation recommends to setup instrumentation from a
// dedicated file, which can be required before anything else in the application;
// e.g. by running node with `--require ./instrumentation.js`. See
// https://opentelemetry.io/docs/languages/js/getting-started/nodejs/#setup for details.

/* eslint-disable @typescript-eslint/no-unused-vars */

import {MetricReader, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { SpanExporter, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { trace } from '@opentelemetry/api';

import { OTLPTraceExporter as OTLPTraceExporterHttp } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter as OTLPMetricExporterHttp } from '@opentelemetry/exporter-metrics-otlp-http';

const otelEndpoint = process.env.OTEL_COLLECTOR_ENDPOINT || '127.0.0.1:4318';


function setupTraceExporter(): SpanExporter | undefined {  
  return new OTLPTraceExporterHttp({
    url: `http://${otelEndpoint}/v1/traces`,
    timeoutMillis: 10000,
  });

}


function setupMetricReader(): MetricReader | undefined {
  return new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporterHttp({
      url: `http://${otelEndpoint}/v1/metrics`,
      timeoutMillis: 10000,
    }),
  });
}

export const resource = new Resource({
  [ATTR_SERVICE_NAME]: 'worker-service',
});

const metricReader = setupMetricReader();
export const traceExporter = setupTraceExporter();

export const otelSdk = new NodeSDK({
  resource,
  traceExporter,
  metricReader,
  instrumentations: [],
});
otelSdk.start();