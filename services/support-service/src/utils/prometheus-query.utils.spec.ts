import {
  createWorkerQuery,
  createWorkerQueriesForMultipleWorkers,
} from './prometheus-query.utils';

describe('prometheus-query.utils', () => {
  describe('createWorkerQuery', () => {
    it('should replace $worker placeholder with actual worker ID', () => {
      const baseQuery = 'up{job="worker-$worker"}';
      const workerId = '123';

      const result = createWorkerQuery(baseQuery, workerId);

      expect(result).toBe('up{job="worker-123"}');
    });

    it('should replace multiple $worker placeholders in the same query', () => {
      const baseQuery =
        'rate(cpu_usage{worker_id="$worker", job="worker-$worker"}[5m])';
      const workerId = 'worker-456';

      const result = createWorkerQuery(baseQuery, workerId);

      expect(result).toBe(
        'rate(cpu_usage{worker_id="worker-456", job="worker-worker-456"}[5m])',
      );
    });

    it('should handle queries without $worker placeholder', () => {
      const baseQuery = 'up{job="prometheus"}';
      const workerId = '789';

      const result = createWorkerQuery(baseQuery, workerId);

      expect(result).toBe('up{job="prometheus"}');
    });

    it('should handle empty base query', () => {
      const baseQuery = '';
      const workerId = '123';

      const result = createWorkerQuery(baseQuery, workerId);

      expect(result).toBe('');
    });

    it('should handle empty worker ID', () => {
      const baseQuery = 'up{job="worker-$worker"}';
      const workerId = '';

      const result = createWorkerQuery(baseQuery, workerId);

      expect(result).toBe('up{job="worker-"}');
    });

    it('should handle complex worker IDs with special characters', () => {
      const baseQuery = 'memory_usage{worker_id="$worker"}';
      const workerId = 'worker-test_123-abc';

      const result = createWorkerQuery(baseQuery, workerId);

      expect(result).toBe('memory_usage{worker_id="worker-test_123-abc"}');
    });

    it('should handle numeric worker IDs', () => {
      const baseQuery = 'network_bytes{instance="$worker"}';
      const workerId = '42';

      const result = createWorkerQuery(baseQuery, workerId);

      expect(result).toBe('network_bytes{instance="42"}');
    });

    it('should handle queries with $worker in function parameters', () => {
      const baseQuery = 'rate(http_requests_total{worker="$worker"}[5m])';
      const workerId = 'web-001';

      const result = createWorkerQuery(baseQuery, workerId);

      expect(result).toBe('rate(http_requests_total{worker="web-001"}[5m])');
    });

    it('should be case sensitive for $worker placeholder', () => {
      const baseQuery = 'up{job="$WORKER", instance="$worker"}';
      const workerId = '123';

      const result = createWorkerQuery(baseQuery, workerId);

      expect(result).toBe('up{job="$WORKER", instance="123"}');
    });

    it('should handle $worker at the beginning and end of query', () => {
      const baseQuery = '$worker{job="worker-$worker"}';
      const workerId = 'metrics';

      const result = createWorkerQuery(baseQuery, workerId);

      expect(result).toBe('metrics{job="worker-metrics"}');
    });
  });

  describe('createWorkerQueriesForMultipleWorkers', () => {
    it('should create regex patterns for multiple worker IDs', () => {
      const baseQuery = 'up{job="worker-$worker", worker_id="$worker"}';
      const workerIds = ['123', '456', '789'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      expect(result).toBe(
        'up{job=~"worker-123|worker-456|worker-789", worker_id=~"123|456|789"}',
      );
    });

    it('should replace $worker placeholders with regex groups', () => {
      const baseQuery = 'memory_usage{instance="$worker"}';
      const workerIds = ['web-1', 'web-2'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      expect(result).toBe('memory_usage{instance="(web-1|web-2)"}');
    });

    it('should handle single worker ID', () => {
      const baseQuery = 'cpu_usage{worker_id="$worker"}';
      const workerIds = ['single-worker'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      expect(result).toBe('cpu_usage{worker_id=~"single-worker"}');
    });

    it('should return original query when worker IDs array is empty', () => {
      const baseQuery = 'up{job="worker-$worker"}';
      const workerIds: string[] = [];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      expect(result).toBe(baseQuery);
    });

    it('should return original query when no $worker placeholder exists', () => {
      const baseQuery = 'up{job="prometheus"}';
      const workerIds = ['123', '456'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      expect(result).toBe(baseQuery);
    });

    it('should handle worker IDs with special regex characters', () => {
      const baseQuery = 'network_io{job="worker-$worker"}';
      const workerIds = ['worker.1', 'worker+2', 'worker[3]'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      expect(result).toBe(
        'network_io{job=~"worker-worker.1|worker-worker+2|worker-worker[3]"}',
      );
    });

    it('should handle complex queries with multiple patterns', () => {
      const baseQuery =
        'rate(http_requests{job="worker-$worker", worker_id="$worker", instance="$worker"}[5m])';
      const workerIds = ['api-1', 'api-2', 'api-3'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      const expectedResult =
        'rate(http_requests{job=~"worker-api-1|worker-api-2|worker-api-3", worker_id=~"api-1|api-2|api-3", instance="(api-1|api-2|api-3)"}[5m])';
      expect(result).toBe(expectedResult);
    });

    it('should handle numeric worker IDs', () => {
      const baseQuery = 'disk_usage{job="worker-$worker", worker_id="$worker"}';
      const workerIds = ['1', '2', '3'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      expect(result).toBe(
        'disk_usage{job=~"worker-1|worker-2|worker-3", worker_id=~"1|2|3"}',
      );
    });

    it('should handle mixed alphanumeric worker IDs', () => {
      const baseQuery = 'container_cpu{job="worker-$worker"}';
      const workerIds = ['node1', 'node2', 'worker-abc', '123'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      const expectedResult =
        'container_cpu{job=~"worker-node1|worker-node2|worker-worker-abc|worker-123"}';
      expect(result).toBe(expectedResult);
    });

    it('should preserve other parts of query unchanged', () => {
      const baseQuery =
        'avg_over_time(cpu_percent{job="worker-$worker", env="production"}[10m])';
      const workerIds = ['prod-1', 'prod-2'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      const expectedResult =
        'avg_over_time(cpu_percent{job=~"worker-prod-1|worker-prod-2", env="production"}[10m])';
      expect(result).toBe(expectedResult);
    });

    it('should handle empty worker IDs in array', () => {
      const baseQuery = 'up{worker_id="$worker"}';
      const workerIds = ['', 'valid-worker', ''];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      expect(result).toBe('up{worker_id=~"|valid-worker|"}');
    });

    it('should handle queries with only job pattern', () => {
      const baseQuery = 'memory_bytes{job="worker-$worker"}';
      const workerIds = ['mem-1', 'mem-2'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      expect(result).toBe('memory_bytes{job=~"worker-mem-1|worker-mem-2"}');
    });

    it('should handle queries with only worker_id pattern', () => {
      const baseQuery = 'disk_io{worker_id="$worker"}';
      const workerIds = ['disk-1', 'disk-2'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      expect(result).toBe('disk_io{worker_id=~"disk-1|disk-2"}');
    });

    it('should handle queries with only generic $worker pattern', () => {
      const baseQuery = 'network_packets{instance="$worker"}';
      const workerIds = ['net-1', 'net-2'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      expect(result).toBe('network_packets{instance="(net-1|net-2)"}');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle very long worker IDs', () => {
      const baseQuery = 'metric{worker_id="$worker"}';
      const longWorkerId = 'a'.repeat(1000);

      const result = createWorkerQuery(baseQuery, longWorkerId);

      expect(result).toBe(`metric{worker_id="${longWorkerId}"}`);
    });

    it('should handle worker IDs with quotes and special characters', () => {
      const baseQuery = 'test{label="$worker"}';
      const workerId = 'worker"with\'quotes';

      const result = createWorkerQuery(baseQuery, workerId);

      expect(result).toBe('test{label="worker"with\'quotes"}');
    });

    it('should handle Unicode characters in worker IDs', () => {
      const baseQuery = 'unicode_test{worker="$worker"}';
      const workerId = 'worker-测试-αβγ';

      const result = createWorkerQuery(baseQuery, workerId);

      expect(result).toBe('unicode_test{worker="worker-测试-αβγ"}');
    });

    it('should handle large number of worker IDs', () => {
      const baseQuery = 'load_test{job="worker-$worker"}';
      const workerIds = Array.from({ length: 100 }, (_, i) => `worker-${i}`);

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      expect(result).toContain('job=~"worker-worker-0|worker-worker-1');
      expect(result).toContain('worker-worker-99"');
      expect(result.split('|')).toHaveLength(100);
    });

    it('should handle worker IDs with pipe characters (regex special)', () => {
      const baseQuery = 'pipe_test{worker_id="$worker"}';
      const workerIds = ['worker|1', 'worker|2'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      expect(result).toBe('pipe_test{worker_id=~"worker|1|worker|2"}');
    });

    it('should handle empty base query with multiple workers', () => {
      const baseQuery = '';
      const workerIds = ['1', '2', '3'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      expect(result).toBe('');
    });

    it('should handle queries with escaped characters', () => {
      const baseQuery = 'escaped_test{path="/var/log/$worker.log"}';
      const workerId = 'app\\server';

      const result = createWorkerQuery(baseQuery, workerId);

      expect(result).toBe('escaped_test{path="/var/log/app\\server.log"}');
    });
  });

  describe('real-world Prometheus query scenarios', () => {
    it('should handle typical CPU usage query', () => {
      const baseQuery =
        'rate(container_cpu_usage_seconds_total{job="worker-$worker", container!="POD"}[5m])';
      const workerIds = ['node-1', 'node-2', 'node-3'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      const expectedResult =
        'rate(container_cpu_usage_seconds_total{job=~"worker-node-1|worker-node-2|worker-node-3", container!="POD"}[5m])';
      expect(result).toBe(expectedResult);
    });

    it('should handle memory usage query with aggregation', () => {
      const baseQuery =
        'avg_over_time(container_memory_usage_bytes{worker_id="$worker"}[10m])';
      const workerIds = ['mem-worker-1', 'mem-worker-2'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      const expectedResult =
        'avg_over_time(container_memory_usage_bytes{worker_id=~"mem-worker-1|mem-worker-2"}[10m])';
      expect(result).toBe(expectedResult);
    });

    it('should handle network I/O query', () => {
      const baseQuery =
        'sum(rate(container_network_receive_bytes_total{job="worker-$worker"}[1m]))';
      const workerIds = ['net-1', 'net-2'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      const expectedResult =
        'sum(rate(container_network_receive_bytes_total{job=~"worker-net-1|worker-net-2"}[1m]))';
      expect(result).toBe(expectedResult);
    });

    it('should handle disk I/O query with multiple labels', () => {
      const baseQuery =
        'irate(node_disk_io_time_seconds_total{job="worker-$worker", worker_id="$worker", device!~"dm-.*"}[5m])';
      const workerIds = ['storage-1', 'storage-2'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      const expectedResult =
        'irate(node_disk_io_time_seconds_total{job=~"worker-storage-1|worker-storage-2", worker_id=~"storage-1|storage-2", device!~"dm-.*"}[5m])';
      expect(result).toBe(expectedResult);
    });

    it('should handle custom application metrics', () => {
      const baseQuery =
        'application_requests_per_second{instance="$worker", status="success"}';
      const workerIds = ['app-server-1', 'app-server-2', 'app-server-3'];

      const result = createWorkerQueriesForMultipleWorkers(
        baseQuery,
        workerIds,
      );

      const expectedResult =
        'application_requests_per_second{instance="(app-server-1|app-server-2|app-server-3)", status="success"}';
      expect(result).toBe(expectedResult);
    });
  });
});
