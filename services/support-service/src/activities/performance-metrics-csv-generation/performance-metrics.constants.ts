const PERFORMANCE_METRICS_QUERIES = {
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
};

export default PERFORMANCE_METRICS_QUERIES;
