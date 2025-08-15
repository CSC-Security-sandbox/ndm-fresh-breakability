export const SYS_INV_SPECS_QUERIES = {
  CPU_CORES: {
    query: 'count(node_cpu_seconds_total{mode="system"})',
    step: process.env.STEP_5MIN ?? '5m',
  },
  MEMORY_GB: {
    query: 'node_memory_MemTotal_bytes / (1024 * 1024 * 1024)',
    step: process.env.STEP_5MIN ?? '5m',
  },
  DISK_GB: {
    query: 'node_filesystem_size_bytes{mountpoint="/"} / (1024 * 1024 * 1024)',
    step: process.env.STEP_5MIN ?? '5m',
  },
  NETWORK_CONFIG: {
    query: 'node_network_info',
    step: process.env.STEP_5MIN ?? '5m',
  },
  DISK_USAGE: {
    query: `(node_filesystem_size_bytes{mountpoint='/'} - node_filesystem_free_bytes{mountpoint='/'}) / node_filesystem_size_bytes{mountpoint='/'} * 100 > ${parseInt(process.env.NODE_DISK_THRESHOLD ?? '90', 10)}`,
    step: process.env.STEP_5MIN ?? '5m',
  },
  RUNNING_PROCESSES: {
    query: 'process_start_time_seconds',
    step: process.env.STEP_5MIN ?? '5m',
  },
};

export default SYS_INV_SPECS_QUERIES;
