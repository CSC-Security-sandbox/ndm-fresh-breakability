import { Test, TestingModule } from '@nestjs/testing';
import { PrometheusClientService } from './prometheus-client.service';
import { PrometheusService } from './prometheus.service';

describe('PrometheusClientService', () => {
  let service: PrometheusClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrometheusClientService,
        {
          provide: PrometheusService,
          useValue: {
            queryPrometheusRange: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PrometheusClientService>(PrometheusClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
