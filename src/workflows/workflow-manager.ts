import { WorkFlows } from "src/work-manager/work-manager.types";
import { ValidateConnectionsWorkflow } from "./validate-connection/validate-connection.workflow";
import { ListPathsWorkflow } from "./workflows";

export class WorkflowManager {
  static createWorkflowInstance(name: string): any {
    switch (name) {
      case WorkFlows.VALIDATE_CONNECTION:
        return ValidateConnectionsWorkflow
      case WorkFlows.LIST_PATHS:
        return ListPathsWorkflow
      default:
        throw new Error(`Workflow with ${name} not found`);
    }
  }
}
