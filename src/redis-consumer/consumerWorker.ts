import { parentPort, workerData } from 'worker_threads';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RedisConsumerService } from './redis-consumer.service';

(async () => {
    console.log(`📌 consumerWorker.js: Worker thread starting for jobRunId=${workerData?.jobRunId}`);

    const app = await NestFactory.createApplicationContext(AppModule);
    const consumerService = app.get(RedisConsumerService);

    try {
        if (!workerData?.jobRunId || !workerData?.consumerType || !workerData?.readerName) {
            throw new Error('Missing required workerData parameters');
        }

        const { jobRunId, readerName, consumerType } = workerData;
        console.log(`🔄 consumerWorker.js: Starting consumer for jobRunId=${jobRunId}, readerName=${readerName}, consumerType=${consumerType}`);

        await consumerService.startConsumerCall(jobRunId, readerName, consumerType);

        console.log('✅ consumerWorker.js: Consumer service call completed successfully');
        parentPort?.postMessage({ success: true });

    } catch (error) {
        console.error('❌ consumerWorker.js: Error occurred', error);
        parentPort?.postMessage({ success: false, error: error.message });
    } finally {
        console.log('📌 consumerWorker.js: Closing NestJS context...');
        await app.close();
        console.log('✅ consumerWorker.js: NestJS context closed');
    }
})();
