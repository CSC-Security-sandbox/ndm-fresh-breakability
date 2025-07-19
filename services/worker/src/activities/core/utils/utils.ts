import { Cmd, JobManagerContext, TaskInfo, TaskStatus, TaskType } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import { basePrefix } from "src/activities/utils/utils";


export const buildTask = (taskType: TaskType, jobRunId: string, jobContext:  JobManagerContext, commands: Cmd[]): TaskInfo => new TaskInfo(
  uuid4(), 
  jobRunId, 
  taskType, 
  TaskStatus.PENDING, 
  jobContext.jobConfig.workerIds[0],
  jobContext.jobConfig.sourceFileServer.pathId,
  commands,
  jobContext.jobConfig.destinationFileServer ? jobContext.jobConfig.destinationFileServer.pathId: null,
  '',
  0
)