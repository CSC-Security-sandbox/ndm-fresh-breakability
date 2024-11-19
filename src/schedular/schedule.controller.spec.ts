import { Test, TestingModule } from '@nestjs/testing';
import { SchedularController } from './schedule.controller';
import { SchedularService } from './schedule.service';
import { Logger } from '@nestjs/common';

describe('SchedularController', () => {
  let schedularController: SchedularController;
  let schedularService: SchedularService;

  const mockSchedularService = {
    handleCron: jest.fn().mockResolvedValue('Cron job processed successfully'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SchedularController],
      providers: [
        {
          provide: SchedularService,
          useValue: mockSchedularService,
        },
      ],
    }).compile();

    schedularController = module.get<SchedularController>(SchedularController);
    schedularService = module.get<SchedularService>(SchedularService);
  });

  it('should be defined', () => {
    expect(schedularController).toBeDefined();
  });

  it('should execute handleCron and log the execution', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log');

    const result = await schedularController.handleCron();

    expect(result).toBe('Cron job processed successfully');
    expect(mockSchedularService.handleCron).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('Cron job executed at: ', expect.any(Date));
  });

  it('should handle errors in handleCron gracefully', async () => {
    mockSchedularService.handleCron.mockRejectedValueOnce(new Error('Cron job failed'));
    try {
      await schedularController.handleCron();
    } catch (error) {
      expect(error.message).toBe('Cron job failed');
    }
    expect(mockSchedularService.handleCron).toHaveBeenCalled();
  });
});
