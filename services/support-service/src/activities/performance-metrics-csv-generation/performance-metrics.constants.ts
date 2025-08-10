const PERFORMANCE_METRICS_QUERIES = {
  // Container/Infrastructure Metrics
  CPU_PERCENT: {
    query:
      'sum(rate(container_cpu_usage_seconds_total{container!="",pod!=""}[5m])) by (namespace, pod) * 100',
    step: process.env.STEP_1hr,
  },
  MEMORY_MB: {
    query:
      'sum(container_memory_usage_bytes{container!="",pod!=""}) by (namespace, pod) / (1024*1024)',
    step: process.env.STEP_1hr,
  },
  DISK_WRITE_BPS: {
    query:
      'sum(rate(container_fs_writes_bytes_total{container!="",pod!=""}[5m])) by (namespace, pod) * 8',
    step: process.env.STEP_1hr,
  },
  DISK_READ_BPS: {
    query:
      'sum(rate(container_fs_reads_bytes_total{container!="",pod!=""}[5m])) by (namespace, pod) * 8',
    step: process.env.STEP_1hr,
  },
  NETWORK_THROUGHPUT_BPS: {
    query:
      '(sum(rate(container_network_receive_bytes_total{pod!=""}[2m])) by (namespace, pod) + sum(rate(container_network_transmit_bytes_total{pod!=""}[2m])) by (namespace, pod)) * 8',
    step: process.env.STEP_1hr,
  },

  // Service/Application Metrics - Original queries
  SERVICE_REQUEST_RATE: {
    query:
      'sum by (operation, service_name, service_role) (rate(service_requests[2m]))',
    step: process.env.STEP_1hr,
  },
  SERVICE_LATENCY_P95: {
    query:
      'histogram_quantile(0.95, sum(rate(service_latency_bucket[5m])) by (operation, service_name, service_role, le)) * 1000',
    step: process.env.STEP_1hr,
  },
  CLIENT_ERROR_RATE: {
    query: 'sum by (service_name, service_role) (rate(client_errors[5m]))',
    step: process.env.STEP_1hr,
  },
  SERVICE_ERROR_RATE_BY_TYPE: {
    query:
      'sum by (service_name, error_type) (rate(service_errors_with_type[5m]))',
    step: process.env.STEP_1hr,
  },
};

export default PERFORMANCE_METRICS_QUERIES;
