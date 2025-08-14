export const PROMETHEUS_QUERIES = {
  RUNNING_SERVICES_AND_PODS: {
    query: 'kube_pod_status_phase{phase="Running"} == 1',
    step: process.env.STEP_4Hr,
  },
  CPU_USAGE_CP: {
    query:
      '100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
    step: process.env.STEP_5MIN,
  },
  MEMORY_USAGE_CP: {
    query:
      '100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))',
    step: process.env.STEP_5MIN,
  },
  CPU_USAGE_WORKER: {
    query:
      'worker_system_cpu_usage{core=~"cpu.*|average", job="worker-$worker", worker_id="$worker"}',
    step: process.env.STEP_5MIN,
  },
  MEMORY_USAGE_WORKER: {
    query:
      'worker_system_memory{type="usage_percent", job="worker-$worker", worker_id="$worker"}',
    step: process.env.STEP_5MIN,
  },
  SYSTEM_UPTIME: {
    query: '(node_time_seconds - node_boot_time_seconds)/3600',
    step: process.env.STEP_1Hr,
  },
  CP_BUILD_DETAILS: {
    query:
      'count by (pod, label_build_version) (kube_pod_labels{label_build_version!="", namespace="datamigrator"})',
    step: process.env.STEP_4Hr,
  },
  WORKER_BUILD_DETAILS: {
    query: 'worker_info{worker_id="$worker"}',
    step: process.env.STEP_4Hr,
  },
};
