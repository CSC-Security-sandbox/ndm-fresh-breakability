import { parentPort, workerData } from 'worker_threads';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RedisConsumerService } from './redis-consumer.service';

(async () => {
    const app = await NestFactory.createApplicationContext(AppModule);
    try {
        console.log('consumerWorker.js: Bootstrapping NestJS inside worker');
        const consumerService = app.get(RedisConsumerService);
        const { jobRunId, readerName, consumerType } = workerData;
        await consumerService.startConsumerCall(jobRunId, readerName, consumerType);
        parentPort?.postMessage({ success: true });
    } catch (error) {
        console.error('consumerWorker.js: Error bootstrapping NestJS inside worker', error);
        parentPort?.postMessage({ success: false, error: error.message });
    }
    finally {
        if (app) {
            console.log('consumerWorker.js: NestJS context closed');
            await app.close();
        }
    }    
})();
