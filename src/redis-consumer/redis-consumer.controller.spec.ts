import { Test, TestingModule } from '@nestjs/testing';
import { RedisConsumerController } from './redis-consumer.controller';
import { RedisConsumerService } from './redis-consumer.service';
import { ConsumerDto } from './redis-consumer.dto';
import { ConsumerType } from 'src/enum/redis-consumer.enum';

describe('RedisConsumerController', () => {
    let controller: RedisConsumerController;
    let service: RedisConsumerService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [RedisConsumerController],
            providers: [
                {
                    provide: RedisConsumerService,
                    useValue: {
                        startConsumer: jest.fn(),
                        stopConsumer: jest.fn(),
                        listActiveConsumers: jest.fn().mockResolvedValue(['job1', 'job2']),
                        isConsumerRunning: jest.fn().mockResolvedValue(true),
                        getConsumerKey: jest.fn((jobRunId, consumerType) => `${jobRunId}_${consumerType}`)
                    }
                }
            ],
        }).compile();

        controller = module.get<RedisConsumerController>(RedisConsumerController);
        service = module.get<RedisConsumerService>(RedisConsumerService);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('start()', () => {
        it('should call startConsumer and return success', async () => {
            const consumerDto: ConsumerDto = { jobRunId: 'test-job' };
            const result = await controller.start(consumerDto);

            expect(service.startConsumer).toHaveBeenCalledWith('test-job');
            expect(result).toEqual({ success: true, message: 'Consumer started successfully.' });
        });
    });

    describe('stop()', () => {
        it('should call stopConsumer and return success', async () => {
            const jobRunId = 'test-job';
            const consumerType = ConsumerType.files;
            const all = true;

            const result = await controller.stop(jobRunId, consumerType, all);

            expect(service.stopConsumer).toHaveBeenCalledWith(jobRunId, consumerType, true);
            expect(result).toEqual({ success: true, message: 'Consumer stopped successfully.' });
        });
    });

    describe('listActiveConsumers()', () => {
        it('should return active consumers', async () => {
            const result = await controller.listActiveConsumers();

            expect(service.listActiveConsumers).toHaveBeenCalled();
            expect(result).toEqual({ success: true, data: ['job1', 'job2'] });
        });
    });

    describe('isConsumerRunning()', () => {
        it('should return true if consumer is running', async () => {
            const jobRunId = 'test-job';
            const consumerType = ConsumerType.files;
            const consumerKey = `${jobRunId}_${consumerType}`;

            jest.spyOn(service, 'getConsumerKey').mockReturnValue(consumerKey);

            const result = await controller.isConsumerRunning(jobRunId, consumerType);

            expect(service.isConsumerRunning).toHaveBeenCalledWith(consumerKey);
            expect(result).toEqual({ success: true, isRunning: true });
        });
    });
});
