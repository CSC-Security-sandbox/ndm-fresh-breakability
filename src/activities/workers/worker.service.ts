import { JobContextFactory, RedisUtils, TaskStats } from '@netapp-cloud-datamigrate/jobs-lib';
import { join } from 'path';
import * as workerpool from 'workerpool';
import { DiscoveryPayload, MessageType, WorkerMessage } from '../types/tasks';

class WorkerManager {
  private availableDiscoveryThreads = 5;
  private readonly pool: workerpool.Pool;

  constructor() {
    this.pool = workerpool.pool(join(__dirname, 'childprocess/scan.childprocess.js'), {
      maxWorkers: this.availableDiscoveryThreads,
    });
  }

  async assignTasksToWorkerThread(payload: DiscoveryPayload, traceId: string): Promise<any> {
    console.log(`Trace Id ${traceId} assigned to worker thread, Total Operations ${payload.data.commands.length}`);
    return new Promise<any>((resolve, reject) => {
      let isCompleted = false;
      this.pool.exec('discovery', [{ data: payload.data }], {
        on: async (message: WorkerMessage) => {
          const jobContext = await this.getJobContext(traceId);
          await this.dispatch(message, jobContext);
          if (message.type === MessageType.ScanCompleted && !isCompleted) {
            isCompleted = true;
            resolve({
              status: 'success',
              data: message
            });
          }
        },
      })
        .catch((error: Error) => {
          console.error(`Error executing worker task: ${error.message}`);
          reject(error);
        });
    });
  }

  private async dispatch(message: WorkerMessage, jobContext): Promise<void> {
    try {
      if (message.type === MessageType.ProcessInventory) {
        message.inventory.forEach(async (i) => {
          if (i.isDirectory) {
            if (!jobContext.dirsInfo) jobContext.dirsInfo.init();
            const id = await jobContext.appendToDirList(i);
            jobContext.dirsInfo.lastId = id;
            jobContext.dirsInfo.numMessages++;
            console.log(i.jobRunId, `***************Appending to dir list***************`);
          } else {
            if (!jobContext.filesInfo) jobContext.filesInfo.init();
            const id = await jobContext.appendToFileList(i);
            jobContext.filesInfo.lastId = id;
            jobContext.filesInfo.numMessages++;
            console.log(i.jobRunId, `***************Appending to file list***************`);
          }
        })
      }
    } catch (error) {
      console.error("THIS IS NOT WHAT I WANT -> ", error);
    }
  }

  private async getJobContext(traceId: string) {
    let redisClient = await RedisUtils.getClient();
    if (!redisClient.isOpen) redisClient = await redisClient.connect();
    const contextProvider = JobContextFactory.getProvider('redis', redisClient);
    return await contextProvider.getJobContext(traceId);
  }
}
export const workerManager = new WorkerManager();