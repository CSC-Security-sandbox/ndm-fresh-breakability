import { Injectable } from "@nestjs/common";
import { WorkFlowOptions } from "./worker-options.factory";
import { WorkerConfiguration } from "../work-manager.types";
import { ListPathActivity } from "src/activities/list-path/list-path.service";
import { WorkFlowType } from "./worker-options.types";
import { NativeConnection } from "@temporalio/worker";
import { ValidateConnectionActivity } from "src/activities/validate-connection/validate-connection.service";
import { DiscoveryActivity } from "src/activities/discovery/discovery.activities";
import { WorkerService } from "src/activities/workers/worker.service";

@Injectable()
export class WorkerOptionsService {
  constructor(
    private readonly listPathActivityService: ListPathActivity,
    private readonly validateConnectionService: ValidateConnectionActivity,
    private readonly discoveryActivities: DiscoveryActivity,
    private readonly workerService: WorkerService
  ) {}

  createWorkerOptions(id: string, config: WorkerConfiguration, workerId: string, connection: NativeConnection) {
    switch (config.configName) {
      case WorkFlowType.PARENT_WORKFLOW:
        return new WorkFlowOptions(id, workerId, connection, 'ParentWorkflow-TaskQueue', config);
      case WorkFlowType.WORKER_SPECIFIC_WORKFLOW:
        return new WorkFlowOptions(id, workerId, connection, 'TaskQueue', config, {
            listPath: this.listPathActivityService.listPath.bind(this.listPathActivityService),
            validate: this.validateConnectionService.validate.bind(this.validateConnectionService),
            fetchTasks: this.discoveryActivities.fetchTasks.bind(this.discoveryActivities),
            publishTask: this.discoveryActivities.publishTask.bind(this.discoveryActivities),
            discoveryStatusUpdate: this.discoveryActivities.discoveryStatusUpdate.bind(this.discoveryActivities),
            discoveryProcess: this.discoveryActivities.discoveryStatusUpdate.bind(this.discoveryActivities),
            assignTasksToWorkerThread: this.workerService.assignTasksToWorkerThread.bind(this.workerService),
        });
      case WorkFlowType.JOB_SPECIFIC_WORKFLOW:
        return new WorkFlowOptions(id, workerId, connection, 'TaskQueue', config, undefined);
      default:
        return undefined;
    }
  }
}