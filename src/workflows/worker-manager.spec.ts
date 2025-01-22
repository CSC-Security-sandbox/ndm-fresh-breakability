import { WorkflowManager } from './workflow-manager';
import { WorkFlows } from 'src/work-manager/work-manager.types';
import { ValidateConnectionsWorkflow } from './validate-connection/validate-connection.workflow';

describe('WorkflowManager', () => {
  describe('createWorkflowInstance', () => {
    it('should return the ValidateConnectionsWorkflow class when the name is VALIDATE_CONNECTION', () => {
      const workflowInstance = WorkflowManager.createWorkflowInstance(WorkFlows.VALIDATE_CONNECTION);
      expect(workflowInstance).toBe(ValidateConnectionsWorkflow);
    });

    it('should throw an error when the workflow name is not found', () => {
      const invalidWorkflowName = 'INVALID_WORKFLOW';
      expect(() => WorkflowManager.createWorkflowInstance(invalidWorkflowName)).toThrowError(
        `Workflow with ${invalidWorkflowName} not found`
      );
    });

    it('should throw an error when the workflow name is an empty string', () => {
      expect(() => WorkflowManager.createWorkflowInstance('')).toThrowError(
        'Workflow with  not found'
      );
    });
  });
});
