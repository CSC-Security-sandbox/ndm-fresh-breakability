
export class WorkflowManager {
  static createWorkflowInstance(name: string): any {
    switch (name) {
      default:
        throw new Error(`Workflow with ${name} not found`);
    }
  }
}
