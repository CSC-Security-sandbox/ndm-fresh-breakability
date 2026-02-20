const BUILD_VERSION_QUERIES = {
  WORKER: 'worker_info',
  CONTROL_PLANE:
    'kube_pod_labels{label_build_version!="",namespace="datamigrator"}',
};

export const GLOBAL_SETTING_KEYS = {
  CP_VERSION: 'CP_VERSION',
};

export default BUILD_VERSION_QUERIES;
