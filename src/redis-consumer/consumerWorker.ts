import { parentPort, workerData } from 'worker_threads';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RedisConsumerService } from './redis-consumer.service';
import { Logger } from '@nestjs/common';
import { ConsumerType } from '../enum/redis-consumer.enum';

(async () => {
     let logger = new Logger("Worker Service");
     logger.log(`📌 consumerWorker.js: Worker thread starting for jobRunId=${workerData?.jobRunId}`);

    const app = await NestFactory.createApplicationContext(AppModule);
    const consumerService = app.get(RedisConsumerService);

    try {
        if (!workerData?.jobRunId) {
            throw new Error('Missing required workerData parameters');
        }

        const { jobRunId, consumerType } = workerData;
        let { readerName } = workerData
        logger.log(`🔄 consumerWorker.js: Starting consumer for jobRunId=${jobRunId}, readerName=${readerName}, consumerType=${consumerType}`);

        if (consumerType) {
            const dynamicReaderName = `${consumerType}-reader`;
            await consumerService.startConsumerCall(jobRunId, dynamicReaderName, consumerType);
        }
        else {
            await Promise.all(
                Object.values(ConsumerType).map(type => {
                    const dynamicReaderName = `${type}-reader`;
                    return consumerService.startConsumerCall(jobRunId, dynamicReaderName, type);
                })
            );
        }

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
