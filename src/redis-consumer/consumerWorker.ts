import { parentPort, workerData } from 'worker_threads';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RedisConsumerService } from './redis-consumer.service';
import { Logger } from '@nestjs/common';

(async () => {
     let logger = new Logger("Worker Service");
     logger.log(`📌 consumerWorker.js: Worker thread starting for jobRunId=${workerData?.jobRunId}`);

    const app = await NestFactory.createApplicationContext(AppModule);
    const consumerService = app.get(RedisConsumerService);

    try {
        if (!workerData?.jobRunId || !workerData?.consumerType || !workerData?.readerName) {
            throw new Error('Missing required workerData parameters');
        }

        const { jobRunId, readerName, consumerType } = workerData;
        logger.log(`🔄 consumerWorker.js: Starting consumer for jobRunId=${jobRunId}, readerName=${readerName}, consumerType=${consumerType}`);

        await consumerService.startConsumerCall(jobRunId, readerName, consumerType);

        logger.log('✅ consumerWorker.js: Consumer service call completed successfully');
        parentPort?.postMessage({ success: true });

    } catch (error) {
        logger.error('❌ consumerWorker.js: Error occurred', error);
        parentPort?.postMessage({ success: false, error: error.message });
    } finally {
        logger.log('📌 consumerWorker.js: Closing NestJS context...');
        await app.close();
        logger.log('✅ consumerWorker.js: NestJS context closed');
    }
})();
