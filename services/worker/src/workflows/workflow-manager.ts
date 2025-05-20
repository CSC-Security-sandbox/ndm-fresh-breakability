import { WorkFlows } from "src/work-manager/work-manager.types";
import { ValidateConnectionsWorkflow } from "./validate-connection/validate-connection.workflow";
import { DiscoveryWorkflow, ListPathsWorkflow } from "./workflows";
import { ValidateWorkingDirectoryWorkflow } from "./working-directory/working-directory.workflow";

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
      default:
        throw new Error(`Workflow with ${name} not found`);
    }
  }
}
