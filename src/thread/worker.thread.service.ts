import { Inject, Injectable, Logger } from "@nestjs/common";
import { Worker } from 'worker_threads';
import { MigrateFile, ThreadOperation, ThreadTask, WorkerThreadOutput } from "./worker.thread.type";
import { ConfigService } from "@nestjs/config";
import * as path from 'path';

@Injectable()
export class WorkerThreadService{
    private workers: Worker[] = [];
    private availableWorkers: Worker[] = [];
    private taskQueue: ThreadTask[] = [];
    private activeTasks: Map<string, ThreadTask> = new Map();

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly logger: Logger,
    ){   
        this.initWorkers(this.configService.get('worker.threadCount')||5);    
    }

    private initWorkers(count: number) {
        for (let i = 0; i < count; i++) {
            const workerPath = path.join(__dirname + '/worker.thread.js')
            this.logger.debug(`Creating worker thread with path: ${workerPath}`);
            const worker = new Worker(workerPath);
            this.workers.push(worker);
            this.availableWorkers.push(worker);

            worker.on('message', (result: WorkerThreadOutput) => {
                this.logger.warn(`output from worker thread: ${JSON.stringify(result)}`);
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

                this.availableWorkers.push(worker);
                this.processQueue();
            });

            worker.on('error', (err) => this.logger.error(`Worker error: ${err.message}`));
            worker.on('exit', (code) => this.logger.log(`Worker exited with code ${code}`));
        }
    }

    private processQueue() {
        if (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
            const worker = this.availableWorkers.pop(); 
            const task = this.taskQueue.pop();
            this.logger.debug(`Assigning task to queue for worker thread with operationId: ${JSON.stringify(task)}`);
            if (worker && task) {
                this.activeTasks.set(task.id, task);
                worker.postMessage({
                    Operation: task.Operation,
                    data: task.data,
                    id: task.id,
                });
            }
        }
    }

    async migrateWorkerThread({destinationPath, sourcePath, operationId}: MigrateFile): Promise<any> {
        return new Promise((resolve, reject) => {
            this.logger.debug(`Pushing task to queue for worker thread with operationId: ${JSON.stringify(operationId)}`);
            this.taskQueue.push({ 
                id: operationId, 
                data: { sourcePath, destinationPath, operationId }, 
                Operation: ThreadOperation.COPY_FILE, 
                resolve, reject,
            });
            this.logger.debug(`------------------- TASK SIZE -------------------- ${this.taskQueue.length}`);
            this.processQueue();
        })
    }

    async terminateWorkers() {
        this.logger.log('Terminating all workers threads...');
        for (const worker of this.workers) {
            worker.postMessage({ Operation: ThreadOperation.EXIT }); 
            await new Promise((resolve) => worker.on('exit', resolve)); 
        }
        this.logger.log('All workers threads terminated.');
    }

    onModuleDestroy() {
        this.workers.forEach((worker) => worker.terminate());
    }
}