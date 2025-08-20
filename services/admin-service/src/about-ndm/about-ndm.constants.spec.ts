import BUILD_VERSION_QUERIES from './about-ndm.constants';

describe('BUILD_VERSION_QUERIES', () => {
  it('should be defined', () => {
    expect(BUILD_VERSION_QUERIES).toBeDefined();
  });

  it('should have WORKER query defined', () => {
    expect(BUILD_VERSION_QUERIES.WORKER).toBeDefined();
    expect(typeof BUILD_VERSION_QUERIES.WORKER).toBe('string');
    expect(BUILD_VERSION_QUERIES.WORKER).toBe('worker_info');
  });

  it('should have CONTROL_PLANE query defined', () => {
    expect(BUILD_VERSION_QUERIES.CONTROL_PLANE).toBeDefined();
    expect(typeof BUILD_VERSION_QUERIES.CONTROL_PLANE).toBe('string');
    expect(BUILD_VERSION_QUERIES.CONTROL_PLANE).toBe(
      'kube_pod_labels{label_build_version!="",namespace="datamigrator"}',
    );
  });

  it('should have correct query structure for CONTROL_PLANE', () => {
    const query = BUILD_VERSION_QUERIES.CONTROL_PLANE;

    // Check that it contains the expected components
    expect(query).toContain('kube_pod_labels');
    expect(query).toContain('label_build_version!=""');
    expect(query).toContain('namespace="datamigrator"');
  });

  it('should be an object with exactly two properties', () => {
    const keys = Object.keys(BUILD_VERSION_QUERIES);
    expect(keys).toHaveLength(2);
    expect(keys).toContain('WORKER');
    expect(keys).toContain('CONTROL_PLANE');
  });

  it('should export queries as default', () => {
    expect(BUILD_VERSION_QUERIES).toEqual({
      WORKER: 'worker_info',
      CONTROL_PLANE:
        'kube_pod_labels{label_build_version!="",namespace="datamigrator"}',
    });
  });
});
