import {
  OpenTelemetryInboundInterceptor,
  OpenTelemetryOutboundInterceptor,
  OpenTelemetryInternalsInterceptor,
} from '@temporalio/interceptors-opentelemetry/lib/workflow';

// Export the interceptors
export const interceptors = () => ({
  inbound: [new OpenTelemetryInboundInterceptor()],
  outbound: [new OpenTelemetryOutboundInterceptor()],
  internals: [new OpenTelemetryInternalsInterceptor()],
});

