
import { ValidateConnectionsWorkflow } from "./validate-connection/validate-connection.workflow";
import { DiscoveryWorkflow, ListPathsWorkflow } from "./workflows";
import { ValidateWorkingDirectoryWorkflow } from "./working-directory/working-directory.workflow";
import { ValidatePathsWorkflow } from "./validate-path/validate-path-workflow";
import { WorkFlows } from "src/work-manager/work-manager.types";

export class WorkflowManager {
  static createWorkflowInstance(name: string): any {
    switch (name) {
      case WorkFlows.VALIDATE_CONNECTION:
        return ValidateConnectionsWorkflow
      case WorkFlows.LIST_PATHS:
        return ListPathsWorkflow
      case WorkFlows.DISCOVERY:
        return DiscoveryWorkflow
      case WorkFlows.VALIDATE_EXPORT_PATH_AND_WORKING_DIRECTORY:
        return ValidateWorkingDirectoryWorkflow
      case WorkFlows.VALIDATE_PATHS:
        return ValidatePathsWorkflow
      default:
        throw new Error(`Workflow with ${name} not found`);
    }
  }
}
