import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as path from 'path';
import { Worker } from 'worker_threads';
import { MigrateFile, OperationBand, ThreadOperation, ThreadTask, ThreadTaskInput, WorkerDetails, WorkerThreadOutput } from "./worker.thread.type";


@Injectable()
export class WorkerThreadService{
    private totalThreads: number;
    private activeTasks: Map<string, ThreadTask> = new Map();
    
    private operationBands : Map<string, OperationBand> = new Map<string, OperationBand>();
    
    private workers: Worker[] = [];
    private availableWorkers: Worker[] = [];
    private workerDetails: Map<number, WorkerDetails> = new Map<number, WorkerDetails>();

    private sizes = [
        {name:"1kb", maxFetch: 20}, 
        {name: "1mb", maxFetch: 10}, 
        {name: "10mb", maxFetch: 5}, 
        {name: "100mb", maxFetch: 2}, 
        {name: "1gb", maxFetch: 1}
    ]

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly logger: Logger,
    ){   
        this.totalThreads = this.configService.get('worker.threadCount')||5;
        this.assignThreads()
        this.initWorkers(this.totalThreads);    
    }

    assignThreads = () => {
        const sortedSizes = this.totalThreads <= 5 ? this.sizes.reverse(): this.sizes;
        let remainingThreads = this.totalThreads;
    
        for (let i = 0; i < this.sizes.length; i++) {
            if (remainingThreads > 0) {
                const operationBand: OperationBand = { numberOfThreads: 1, task: []};
                this.operationBands.set(sortedSizes[i].name, operationBand);
                remainingThreads--;
            }
        }

        let i = 0;
        while (remainingThreads > 0) {
            const operationBand:OperationBand = this.operationBands.get(sortedSizes[i].name) ??  { numberOfThreads: 0, task: []};
            operationBand.numberOfThreads++;
            this.operationBands.set(sortedSizes[i].name,operationBand);
            remainingThreads--;
            i = (i + 1) % this.sizes.length; 
        }
        return this.operationBands;
    };

    private initWorkers(count: number) {
        let  j = 0, assignedThreadsForCurrentSize = 0
        for (let i = 0; i < count; i++) {
            const workerPath = path.join(__dirname + '/worker.thread.js')
            this.logger.debug(`Starting worker thread with path: ${workerPath} for Band ${this.sizes[j]} ${j}`);
            const worker = new Worker(workerPath, { workerData: { operationBand: this.sizes[j].name, threadNumber: i } });
            this.workers.push(worker);
            this.availableWorkers.push(worker);
            this.workerDetails.set(worker.threadId, {operationBand: this.sizes[j].name,operatingTasks:[]});
            assignedThreadsForCurrentSize++;

            worker.on('message', (results: WorkerThreadOutput[]) => {

                this.logger.warn(`output from worker thread: ${JSON.stringify(results)}`);

                results.map(result => {
                    // resolve the task
                    if(result.isResolved){
                        const task = this.activeTasks.get(result.id);
                        if(task){
                            task.resolve(result.data);
                            this.activeTasks.delete(result.id);
                        }
                    }
                    // reject the task
                    if(result.isRejected){
                        const task = this.activeTasks.get(result.id);
                        if(task){
                            task.reject(result.data);
                            this.activeTasks.delete(result.id);
                        }
                    }
                });

                this.availableWorkers.push(worker);
                this.logger.debug(`Worker thread: ${worker.threadId} is available`);
                this.processQueue();
            });

            worker.on('error', (err) => {
                this.logger.error(`Worker error: ${err.message}`)
                this.handleWorkerThreadError(worker.threadId);
            });
             
            worker.on('exit', (code) =>{
                 this.logger.log(`Worker exited with code ${code}`)
                 this.handleWorkerThreadError(worker.threadId);
            });

            if (assignedThreadsForCurrentSize >= this.operationBands.get(this.sizes[j].name)?.numberOfThreads) { 
                assignedThreadsForCurrentSize = 0, j++;
            }
            
        }
    }

    handleWorkerThreadError(processId: number) {
        const workerDetails = this.workerDetails.get(processId);
        workerDetails.operatingTasks.forEach((taskId) => {
            const task = this.activeTasks.get(taskId);
            if(task){
                this.logger.error(`Rejecting task with operationId: ${taskId}`);
                task.reject(taskId);
                this.activeTasks.delete(taskId);
            }
        })
    }

    getTasks(bandName: string):ThreadTask[]{
        const band = this.sizes.find(size => size.name === bandName);
        const tasks = this.operationBands.get(bandName).task.splice(0, band.maxFetch);
        this.logger.log(`Fetching tasks from band ${bandName} with ${tasks.length} tasks`);
        if(tasks.length > 0) return tasks;
        const index = this.sizes.indexOf(band);
        for(let i = index - 1; i >= 0; i--) {
            const tasks = this.operationBands.get(this.sizes[i].name).task.splice(0, this.sizes[i].maxFetch);
            this.logger.log(`Fetching tasks from band ${this.sizes[i].name} with ${tasks.length} tasks`);
            if(tasks.length > 0) return tasks;
        }
        for(let i = index + 1; i < this.sizes.length; i++) {
            const tasks = this.operationBands.get(this.sizes[i].name).task.splice(0, this.sizes[i].maxFetch);
            this.logger.log(`Fetching tasks from band ${this.sizes[i].name} with ${tasks.length} tasks`);
            if(tasks.length > 0) return tasks;
        }
        // let remainingTasks = 0;
        // this.operationBands.forEach((band) => {
        //     remainingTasks += band.task.length;
        // })
        // this.logger.debug('remaining tasks: ', remainingTasks);
        return []
    }

    private processQueue() {
        this.logger.error(`available threads ${this.availableWorkers.length }`)
        if (this.availableWorkers.length > 0) {
            const worker = this.availableWorkers.pop(); 
            const tasks:ThreadTask[] = this.getTasks(this.workerDetails.get(worker.threadId).operationBand);
            this.logger.debug(`Processing queue with ${tasks.length} tasks for worker thread: ${worker.threadId}`);
            if (worker && tasks.length > 0) {
                this.logger.debug(`Sending tasks to worker thread: ${JSON.stringify(tasks.length)}`);
                const input: ThreadTaskInput[] = tasks.map((task: ThreadTask) => {
                    this.activeTasks.set(task.id, task);
                    const detail: ThreadTaskInput = {
                        id: task.id,
                        Operation: task.Operation,
                        data: task.data,
                    };
                    return detail
                });
            
                this.workerDetails.get(worker.threadId).operatingTasks = input.map(task => task.id);
                worker.postMessage(input);
            }
            if(worker && tasks.length === 0) {
                this.availableWorkers.push(worker);
            }
        }
    }

    async migrateWorkerThread({destinationPath, sourcePath, operationId, size}: MigrateFile): Promise<any> {
        
        return new Promise((resolve, reject) => {
            const operationBand = this.getTaskBand(size);
            this.operationBands.get(operationBand).task.push({ 
                id: operationId, 
                data: { sourcePath, destinationPath, operationId }, 
                Operation: ThreadOperation.COPY_FILE, 
                resolve, reject,
            });
            this.logger.debug(`Added task to band ${operationBand} with operationId: ${operationId} and current size: ${this.operationBands.get(operationBand).task.length}`);
            this.processQueue();
        })
    }

    onModuleDestroy() {
        this.workers.forEach((worker) => worker.terminate());
    }

    getTaskBand(size: number) {
       if(size <= 1024) return this.sizes[0].name;
       if(size <= 1048576) return this.sizes[1].name;
       if(size <= 10485760) return this.sizes[2].name;
       if(size <= 104857600) return this.sizes[3].name;
       return this.sizes[4].name;
    }

}