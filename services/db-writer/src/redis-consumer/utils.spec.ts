import { getWorkflowId } from './utils';
import { WorkFlows } from '../enum/redis-consumer.enum';
import { RedisUtils } from '@netapp-cloud-datamigrate/jobs-lib/dist/redis/redis-utils';

// Mock the RedisUtils class
jest.mock('@netapp-cloud-datamigrate/jobs-lib/dist/redis/redis-utils');

describe('Utils', () => {
  describe('getWorkflowId', () => {
    const mockJobRunId = 'test-job-run-id-123';

    it('should return correct workflow ID for CUT_OVER job type', () => {
      const result = getWorkflowId(mockJobRunId, 'CUT_OVER');
      expect(result).toBe(`${WorkFlows.CUT_OVER}-${mockJobRunId}`);
      expect(result).toBe(`CutOverWorkFlow-${mockJobRunId}`);
    });

    it('should return correct workflow ID for MIGRATE job type', () => {
      const result = getWorkflowId(mockJobRunId, 'MIGRATE');
      expect(result).toBe(`${WorkFlows.MIGRATE}-${mockJobRunId}`);
      expect(result).toBe(`MigrationWorkflow-${mockJobRunId}`);
    });

    it('should return correct workflow ID for PRECHECK job type', () => {
      const result = getWorkflowId(mockJobRunId, 'PRECHECK');
      expect(result).toBe(`${WorkFlows.PRECHECK}-${mockJobRunId}`);
      expect(result).toBe(`PreCheckValidationWorkflow-${mockJobRunId}`);
    });

    it('should return correct workflow ID for RETRY when isRetryRun is true', () => {
      const result = getWorkflowId(mockJobRunId, 'MIGRATE', true);
      expect(result).toBe(`${WorkFlows.RETRY}-${mockJobRunId}`);
      expect(result).toBe(`RetryMigrationWorkflow-${mockJobRunId}`);
    });

    it('should return normal workflow ID when isRetryRun is false', () => {
      const result = getWorkflowId(mockJobRunId, 'MIGRATE', false);
      expect(result).toBe(`${WorkFlows.MIGRATE}-${mockJobRunId}`);
    });

    it('should return normal workflow ID when isRetryRun is undefined', () => {
      const result = getWorkflowId(mockJobRunId, 'MIGRATE');
      expect(result).toBe(`${WorkFlows.MIGRATE}-${mockJobRunId}`);
    });

    it('should return DISCOVERY workflow ID for unknown job type', () => {
      const result = getWorkflowId(mockJobRunId, 'UNKNOWN_TYPE');
      expect(result).toBe(`${WorkFlows.DISCOVERY}-${mockJobRunId}`);
      expect(result).toBe(`DiscoveryWorkflow-${mockJobRunId}`);
    });

    it('should return DISCOVERY workflow ID for null job type', () => {
      const result = getWorkflowId(mockJobRunId, null as any);
      expect(result).toBe(`${WorkFlows.DISCOVERY}-${mockJobRunId}`);
      expect(result).toBe(`DiscoveryWorkflow-${mockJobRunId}`);
    });

    it('should return DISCOVERY workflow ID for undefined job type', () => {
      const result = getWorkflowId(mockJobRunId, undefined as any);
      expect(result).toBe(`${WorkFlows.DISCOVERY}-${mockJobRunId}`);
      expect(result).toBe(`DiscoveryWorkflow-${mockJobRunId}`);
    });

    it('should return DISCOVERY workflow ID for empty string job type', () => {
      const result = getWorkflowId(mockJobRunId, '');
      expect(result).toBe(`${WorkFlows.DISCOVERY}-${mockJobRunId}`);
      expect(result).toBe(`DiscoveryWorkflow-${mockJobRunId}`);
    });

    it('should handle special characters in jobRunId', () => {
      const specialJobRunId = 'job-run_123@test.com';
      const result = getWorkflowId(specialJobRunId, 'MIGRATE');
      expect(result).toBe(`${WorkFlows.MIGRATE}-${specialJobRunId}`);
    });

    it('should handle case sensitivity for job types', () => {
      // Test lowercase
      const resultLower = getWorkflowId(mockJobRunId, 'cut_over');
      expect(resultLower).toBe(`${WorkFlows.DISCOVERY}-${mockJobRunId}`);

      // Test mixed case
      const resultMixed = getWorkflowId(mockJobRunId, 'Cut_Over');
      expect(resultMixed).toBe(`${WorkFlows.DISCOVERY}-${mockJobRunId}`);
    });

    it('should handle numeric jobRunId', () => {
      const numericJobRunId = '12345';
      const result = getWorkflowId(numericJobRunId, 'MIGRATE');
      expect(result).toBe(`${WorkFlows.MIGRATE}-${numericJobRunId}`);
    });

    it('should handle UUID format jobRunId', () => {
      const uuidJobRunId = '550e8400-e29b-41d4-a716-446655440000';
      const result = getWorkflowId(uuidJobRunId, 'PRECHECK');
      expect(result).toBe(`${WorkFlows.PRECHECK}-${uuidJobRunId}`);
    });

    describe('all job types mapping', () => {
      const testCases = [
        { jobType: 'CUT_OVER', expected: WorkFlows.CUT_OVER },
        { jobType: 'MIGRATE', expected: WorkFlows.MIGRATE },
        { jobType: 'PRECHECK', expected: WorkFlows.PRECHECK },
        { jobType: 'DISCOVERY', expected: WorkFlows.DISCOVERY },
        { jobType: 'INVALID', expected: WorkFlows.DISCOVERY },
      ];

      test.each(testCases)('should map $jobType to $expected workflow', ({ jobType, expected }) => {
        const result = getWorkflowId(mockJobRunId, jobType);
        expect(result).toBe(`${expected}-${mockJobRunId}`);
      });
    });
  });


  describe('Types and Interfaces', () => {
    describe('ReaderStatus type', () => {
      it('should accept valid status values', () => {
        // These tests validate that TypeScript compilation succeeds with valid values
        const activeStatus: import('./utils').ReaderStatus = 'active';
        const inactiveStatus: import('./utils').ReaderStatus = 'inactive';

        expect(activeStatus).toBe('active');
        expect(inactiveStatus).toBe('inactive');
      });
    });

    describe('FileConsumerContext interface', () => {
      it('should create valid FileConsumerContext object', () => {
        const context: import('./utils').FileConsumerContext = {
          jobRunId: 'test-job-123',
          pathId: 'path-456',
          records: [],
          flushTimer: null,
        };

        expect(context.jobRunId).toBe('test-job-123');
        expect(context.pathId).toBe('path-456');
        expect(context.records).toEqual([]);
        expect(context.flushTimer).toBeNull();
      });

      it('should create FileConsumerContext with errorRecoveryTimers', () => {
        const mockTimer = setTimeout(() => {}, 1000);
        const timersSet = new Set<NodeJS.Timeout>([mockTimer]);

        const context: import('./utils').FileConsumerContext = {
          jobRunId: 'test-job-123',
          pathId: 'path-456',
          records: [{ id: 1 }, { id: 2 }],
          flushTimer: mockTimer,
          errorRecoveryTimers: timersSet,
        };

        expect(context.jobRunId).toBe('test-job-123');
        expect(context.pathId).toBe('path-456');
        expect(context.records).toHaveLength(2);
        expect(context.flushTimer).toBe(mockTimer);
        expect(context.errorRecoveryTimers).toBeInstanceOf(Set);
        expect(context.errorRecoveryTimers?.has(mockTimer)).toBe(true);

        clearTimeout(mockTimer);
      });

      it('should handle FileConsumerContext with various record types', () => {
        const records = [
          { type: 'file', name: 'test.txt' },
          { type: 'directory', name: 'folder' },
          'string-record',
          123,
          { nested: { data: 'value' } },
        ];

        const context: import('./utils').FileConsumerContext = {
          jobRunId: 'test-job-123',
          pathId: 'path-456',
          records: records,
          flushTimer: null,
        };

        expect(context.records).toEqual(records);
        expect(context.records).toHaveLength(5);
      });

      it('should handle empty errorRecoveryTimers set', () => {
        const context: import('./utils').FileConsumerContext = {
          jobRunId: 'test-job-123',
          pathId: 'path-456',
          records: [],
          flushTimer: null,
          errorRecoveryTimers: new Set(),
        };

        expect(context.errorRecoveryTimers).toBeInstanceOf(Set);
        expect(context.errorRecoveryTimers?.size).toBe(0);
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    const testJobRunId = 'test-job-run-id-123';

    it('should handle extremely long jobRunId', () => {
      const longJobRunId = 'a'.repeat(1000);
      const result = getWorkflowId(longJobRunId, 'MIGRATE');
      expect(result).toBe(`${WorkFlows.MIGRATE}-${longJobRunId}`);
      expect(result.length).toBe(WorkFlows.MIGRATE.length + 1 + 1000);
    });

    it('should handle jobRunId with special characters and job type combinations', () => {
      const specialJobRunId = 'job-run!@#$%^&*()_+={}[]|\\:";\'<>?,./';
      const result = getWorkflowId(specialJobRunId, 'CUT_OVER');
      expect(result).toBe(`${WorkFlows.CUT_OVER}-${specialJobRunId}`);
    });

    it('should handle whitespace in job types', () => {
      const resultWithSpaces = getWorkflowId(testJobRunId, ' MIGRATE ');
      expect(resultWithSpaces).toBe(`${WorkFlows.DISCOVERY}-${testJobRunId}`);

      const resultWithTabs = getWorkflowId(testJobRunId, '\tCUT_OVER\t');
      expect(resultWithTabs).toBe(`${WorkFlows.DISCOVERY}-${testJobRunId}`);
    });
  });
});
