import { WorkFlows, WorkflowExecutionStatus } from './workflow.types';

describe('WorkflowTypes', () => {
  describe('WorkFlows enum', () => {
    it('should have BINARY_MULTICAST value', () => {
      expect(WorkFlows.BINARY_MULTICAST).toBe('BinaryMulticastWorkflow');
    });
  });

  describe('WorkflowExecutionStatus enum', () => {
    it('should have all expected status values', () => {
      expect(WorkflowExecutionStatus.RUNNING).toBe('RUNNING');
      expect(WorkflowExecutionStatus.COMPLETED).toBe('COMPLETED');
      expect(WorkflowExecutionStatus.FAILED).toBe('FAILED');
      expect(WorkflowExecutionStatus.CANCELLED).toBe('CANCELLED');
      expect(WorkflowExecutionStatus.TERMINATED).toBe('TERMINATED');
      expect(WorkflowExecutionStatus.CONTINUED_AS_NEW).toBe('CONTINUED_AS_NEW');
      expect(WorkflowExecutionStatus.TIMED_OUT).toBe('TIMED_OUT');
    });
  });
});
