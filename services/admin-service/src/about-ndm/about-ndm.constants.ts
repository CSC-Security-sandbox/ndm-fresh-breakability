const BUILD_VERSION_QUERIES = {
  WORKER: 'worker_info',
  CONTROL_PLANE:
    'kube_pod_labels{label_build_version!="",namespace="datamigrator"}',
};

export const VERSIONS_CONF_PATH = '/opt/datamigrator/conf/versions.conf';

export default BUILD_VERSION_QUERIES;
