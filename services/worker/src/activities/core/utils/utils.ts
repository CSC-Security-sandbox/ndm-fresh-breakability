import { Cmd, JobManagerContext, TaskInfo, TaskStatus, TaskType } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import { basePrefix } from "src/activities/utils/utils";
import *  as fs from 'fs';
import { BatchSubDirInput, BatchSubDirOutput } from "../scan/scan-activity.type";
import { calculateHash } from "src/activities/utils/checksum-utils";


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


export const batchSubDirs = async ({batchSize, subDirs, jobContext}: BatchSubDirInput): Promise<BatchSubDirOutput> => {
      const batchDirsId: string[] = []
      while(subDirs.length > batchSize) {
          const batchDirs: string[] = subDirs.splice(0, batchSize);
          const batchId: string = calculateHash(batchDirs)
          batchDirsId.push(batchId);
          await jobContext.setBatchDir(batchId, batchDirs);
      }
      if(subDirs.length > 0) {
          const batchId: string = calculateHash(subDirs);
          batchDirsId.push(batchId);
          await jobContext.setBatchDir(batchId, subDirs);
      }
      return { subDirs: [], batchDirs: batchDirsId };
  }