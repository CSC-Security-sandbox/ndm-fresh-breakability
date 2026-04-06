const BUILD_VERSION_QUERIES = {
  WORKER: 'worker_info',
  CONTROL_PLANE:
    'kube_pod_labels{label_build_version!="",namespace="datamigrator"}',
};

export const VERSIONS_CONF_PATH = '/opt/datamigrator/conf/versions.conf';
export const SERIAL_ID_CONF_PATH = '/opt/datamigrator/conf/serial_id.conf';
export const SERIAL_ID_SETTING_KEY = 'ndm_serial_id';

export default BUILD_VERSION_QUERIES;
