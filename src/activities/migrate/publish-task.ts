import { PublishScanTaskInput } from "./migrate.type";
import { uuid4 } from '@temporalio/workflow';
import { Command, JobContextFactory, RedisUtils, Task } from '@netapp-cloud-datamigrate/jobs-lib';

export const publishSanTask = async ({jobRunId, jobContext, logger,clientConnection}: PublishScanTaskInput): Promise<void> => {
    try {
        const task = new Task(
            uuid4(),
            jobRunId,
            'SCAN',
            'PENDING',
            'worker-1',
            '/Users/calfus-kunalavghade/Desktop/node-fs/test1',
            [],
            '/Users/calfus-kunalavghade/Desktop/node-fs/test2',
            ''
          );
        const ops = {
            0: {
              cmd: 'SCAN',
              status: 'PENDING',
            },
        };
        const directoryBatchSize = 500;
        let counter=0;
        for await (const dir of jobContext.groupReadDirs(jobRunId,directoryBatchSize)) {
          counter++;
          if (counter > directoryBatchSize){
            console.log("breaking the loop of pubish task"); 
            break;
          }
        
          task.commands.push(new Command(dir.path, ops, `cmd-${uuid4()}`))
        }
          
        if(task.commands.length > 0) {
         const id =  await jobContext.appendToTaskList(task);
            jobContext.tasksInfo.lastId = id;
            logger.debug(`[${jobRunId}] Task appended: ${JSON.stringify(task)}`);
        }
        await clientConnection.set(jobRunId, jobContext.serialize());


      } catch (error) {
        logger.error(`[${jobRunId}] Error in publishing task: ${error.message}`); 
      } 
}