import { RedisClientType } from "redis";
import { Logger } from "./utils/logging";
import { RedisUtils } from "./redis/redis-utils";
import { JobContextFactory } from "./job-context-factory";
import { JobContextProvider } from "./job-context-provider";
import { Command, FileInfo, Task } from "./types/metadata-types";
import { JobConfig } from "./types/job-config";
import { JobType } from "./types/enums";
import { FileServerDetails } from "./types/file-server";
import { NFS } from "./types/protocols";
import { JobContext } from "./types/job-context";


export * from './types/metadata-types';
export * from './types/job-config';
export * from './types/enums';
export * from './types/file-server';
export * from './types/protocols';
export * from './types/job-context';
export * from './types/serializable';
export * from './types/stream-collection';

export * from './redis/redis-utils';
export * from './redis/redis-collections';
export * from './redis/redis-job-context';
export * from './redis/redis-context-provider';
export * from './redis/redis-stream-collection';


export * from './utils/logging';
export * from './utils/job-utils';


export * from './job-context-provider';
export * from './job-context-factory';



async function setupContextProvider(): Promise<JobContextProvider> {
    const redisClient: RedisClientType = await RedisUtils.getClient();
    await redisClient.connect();

    const jobContextProvider = JobContextFactory.getProvider('redis', redisClient);
    return jobContextProvider;
}

async function startFilesProducer(jobRunId: string) {
    const logger = Logger.getLogger(jobRunId);
    logger.info(`Starting files producer for job run id: ${jobRunId}`);
    const jobContextProvider = await setupContextProvider();

    const jobConfig = new JobConfig(
        jobRunId    ,
        JobType.DISCOVERY,
        new FileServerDetails(
          'localhost',
          [new NFS('root')],
        ),
        '/mnt/nfs'      
      );
  
    const jobContext: JobContext = await jobContextProvider.buildContext(jobRunId, jobConfig, 'running');

    for (let i = 0; i < 15; i++) {
      const fileInfo = new FileInfo(
        `test${i}.txt`,
        `/mnt/nfs/test${i}.txt`,
        '/mnt/nfs',
        false,
        0,
        0,
        100,
        true,
        new Date(),
        new Date(),
        new Date(),
        'txt',
        'rwxrwxrwx',
        'text',
        0
      );
      logger.info(`Appending file: ${fileInfo.fileName}`);
      await jobContext.appendToFileList(fileInfo);    
    }
}

async function startTasksProducer(jobRunId: string) {
    const logger = Logger.getLogger(jobRunId);
    logger.info(`Starting tasks producer for job run id: ${jobRunId}`);
    const jobContextProvider = await setupContextProvider();
    const jobConfig = new JobConfig(
        jobRunId    ,
        JobType.DISCOVERY,
        new FileServerDetails(
          'localhost',
          [new NFS('root')],
        ),
        '/mnt/nfs'      
      );
  
    const jobContext: JobContext = await jobContextProvider.buildContext(jobRunId, jobConfig, 'running');

    for (let i = 0; i < 15; i++) {
        logger.info(`Appending task: ${i}`);
        const ops = {
            0: {
                cmd: 'SCAN',
                status: 'PENDING',
            },
        }
        const commands = [
            new Command('/mnt/nfs/test0.txt',  ops, 'cmd-1001'),
            new Command('/mnt/nfs/test1.txt',  ops, 'cmd-1002'),
        ]

        const task = new Task(
            `task-${i}`,
            jobRunId,
            'SCAN',
            'pending',
            'worker-1',
            '/mnt/nfs/test.txt',
            null,
            '*.tmp, *.log',
            commands
            );            
        
        await jobContext.appendToTaskList(task);
    }
}

async function startGroupFilesConsumer(jobRunId: string, groupName: string) {
    const logger = Logger.getLogger(jobRunId);
    logger.info(`Starting file consumer for job run id: ${jobRunId}`);
    const jobContextProvider = await setupContextProvider();
    const jobContext = await jobContextProvider.getJobContext(jobRunId);

    if (jobContext) {  
        while(true) {
            try {
            for await (const file of jobContext.groupReadFiles(groupName)) {
                logger.info(`File: ${JSON.stringify(file)}`);
            }
            } catch (err) {
            logger.error(`Error reading files: ${err.message}`, err);
            continue;
            }
        }
    }  
}

async function startFilesConsumer(jobRunId: string, groupName: string) {
    const logger = Logger.getLogger(jobRunId);
    logger.info(`Starting file consumer for job run id: ${jobRunId}`);
    const jobContextProvider = await setupContextProvider();
    const jobContext = await jobContextProvider.getJobContext(jobRunId);

    if (jobContext) {  
        while(true) {
            try {
            for await (const file of jobContext.readFiles(groupName)) {
                logger.info(`File: ${JSON.stringify(file)}`);
            }
            } catch (err) {
            logger.error(`Error reading files: ${err.message}`, err);
            continue;
            }
        }
    }  
}

async function startGroupTasksConsumer(jobRunId: string, groupName: string) {
    const logger = Logger.getLogger(jobRunId);
    logger.info(`Starting tasks consumer for job run id: ${jobRunId}`);
    const jobContextProvider = await setupContextProvider();
    const jobContext = await jobContextProvider.getJobContext(jobRunId);

    if (jobContext) {  
        while(true) {
            try {
            for await (const task of jobContext.groupReadTasks(groupName)) {
                logger.info(`Task: ${JSON.stringify(task)}`);
            }
            } catch (err) {
            logger.error(`Error reading tasks: ${err.message}`, err);
            continue;
            }
        }
    }  
}

async function startTasksConsumer(jobRunId: string, groupName: string) {
    const logger = Logger.getLogger(jobRunId);
    logger.info(`Starting tasks comsumer for job run id: ${jobRunId}`);
    const jobContextProvider = await setupContextProvider();
    const jobContext = await jobContextProvider.getJobContext(jobRunId);

    if (jobContext) {  
        while(true) {
            try {
            for await (const task of jobContext.readTasks(groupName)) {
                logger.info(`Task: ${JSON.stringify(task)}`);
            }
            } catch (err) {
            logger.error(`Error reading tasks: ${err.message}`, err);
            continue;
            }
        }
    }  
}

(async () => {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        throw new Error('Missing job run id');
    }
    const type = args[0];
    const jobRunId = args[1];

    if (type === 'files-producer') {
        await startFilesProducer(jobRunId);
    } else if (type === 'tasks-producer') {
        await startTasksProducer(jobRunId);
    } else if (type === 'group-files-consumer') {
        const groupName = args[2];
        await startGroupFilesConsumer(jobRunId, groupName);
    } else if (type === 'files-consumer') {
        const groupName = args[2];
        await startFilesConsumer(jobRunId, groupName);
    } else if (type === 'group-tasks-consumer') {
        const groupName = args[2];
        await startGroupTasksConsumer(jobRunId, groupName);
    } else if (type === 'tasks-consumer') {
        const groupName = args[2];
        await startTasksConsumer(jobRunId, groupName);
    } else {
        throw new Error(`Unknown job type: ${type}`);
    }

})();
