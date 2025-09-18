import { Cmd, JobManagerContext, TaskInfo, TaskStatus, TaskType } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import * as fs from 'fs';


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

export const isPathExists = async (path: string): Promise<boolean> => {
  try {
    await fs.promises.access(path, fs.constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false; // Path does not exist
    }
  }
  return false;
}


export const isNotWritable = async (filePath: string): Promise<boolean> => {
  try {
    // Single syscall: check both existence and write permissions
    await fs.promises.access(filePath, fs.constants.F_OK | fs.constants.W_OK);
    return false; // exists & writable
  } catch (err: any) {
    if (err.code === "EACCES" || err.code === "EPERM") {
      return true; // exists but not writable
    }
    return false; // doesn't exist or other reason → let caller decide
  }
};