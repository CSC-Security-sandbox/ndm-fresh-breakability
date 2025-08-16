import { WorkflowManager } from './workflow-manager';
import { ValidateConnectionsWorkflow } from "./validate-connection/validate-connection.workflow";
import { DiscoveryWorkflow, ListPathsWorkflow } from "./workflows";
import { ValidateWorkingDirectoryWorkflow } from "./working-directory/working-directory.workflow";
import { WorkFlows } from 'src/work-manager/work-manager.types';


describe('WorkflowManager', () => {
  describe('createWorkflowInstance', () => {
    it('should return ValidateConnectionsWorkflow for VALIDATE_CONNECTION', () => {
      const workflow = WorkflowManager.createWorkflowInstance(WorkFlows.VALIDATE_CONNECTION);
      expect(workflow).toBe(ValidateConnectionsWorkflow);
    });

    it('should return ListPathsWorkflow for LIST_PATHS', () => {
      const workflow = WorkflowManager.createWorkflowInstance(WorkFlows.LIST_PATHS);
      expect(workflow).toBe(ListPathsWorkflow);
    });

    it('should return DiscoveryWorkflow for DISCOVERY', () => {
      const workflow = WorkflowManager.createWorkflowInstance(WorkFlows.DISCOVERY);
      expect(workflow).toBe(DiscoveryWorkflow);
    });

    it('should return ValidateWorkingDirectoryWorkflow for VALIDATE_EXPORT_PATH_AND_WORKING_DIRECTORY', () => {
      const workflow = WorkflowManager.createWorkflowInstance(WorkFlows.VALIDATE_EXPORT_PATH_AND_WORKING_DIRECTORY);
      expect(workflow).toBe(ValidateWorkingDirectoryWorkflow);
    });

    it('should throw an error for an unknown workflow', () => {
      const unknownWorkflow = 'UNKNOWN_WORKFLOW';
      expect(() => {
        WorkflowManager.createWorkflowInstance(unknownWorkflow);
      }).toThrow(`Workflow with ${unknownWorkflow} not found`);
    });
  });
});