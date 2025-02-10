import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InventoryService } from './inventory.service';
import { InventoryEntity } from '../entities/inventory.entity';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { InventoryPayload, InventoryPayloadType } from './inventory.type';
import { Pattern } from '../enum/queues.enum';

describe('InventoryService', () => {
  let service: InventoryService;
  let inventoryRepo: Repository<InventoryEntity>;
  let configService: ConfigService;
  let reportsClient: ClientProxy;

  const mockInventoryRepo = {
    create: jest.fn(),
    insert: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key) => {
      if (key === 'app.rabbitmq.urls') return ['amqp://localhost'];
      if (key === 'app.rabbitmq.reportsQueue') return 'reports_queue';
    }),
  };

  const mockClientProxy = {
    send: jest.fn().mockReturnValue({
      toPromise: jest.fn().mockResolvedValue('success'),
    }),
  };

  const mockPayload = {
    type: InventoryPayloadType.DATA_INSERT,
    data: [{ path: '/path/to/file', fileName: 'file.txt', isDirectory: false }],
  } as InventoryPayload;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: getRepositoryToken(InventoryEntity), useValue: mockInventoryRepo },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClientProxy, useValue: mockClientProxy },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    inventoryRepo = module.get<Repository<InventoryEntity>>(getRepositoryToken(InventoryEntity));
    configService = module.get<ConfigService>(ConfigService);
    reportsClient = module.get<ClientProxy>(ClientProxy);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });


  

  describe('createInventory', () => {
    it('should save inventory records successfully', async () => {
      mockInventoryRepo.create.mockReturnValueOnce(mockPayload.data);
      await service.createInventory(mockPayload.data,'8092ce59-5dfd-4d2f-939a-af51d3580238');

      expect(mockInventoryRepo.create).toHaveBeenCalledWith(mockPayload.data);
      expect(mockInventoryRepo.insert).toHaveBeenCalledWith(mockPayload.data);
    });

    it('should log an error and throw when insert fails', async () => {
      mockInventoryRepo.create.mockReturnValueOnce(mockPayload.data);
      mockInventoryRepo.insert.mockRejectedValueOnce(new Error('Insert failed'));

      await expect(service.createInventory(mockPayload.data,'8092ce59-5dfd-4d2f-939a-af51d3580238')).rejects.toThrow(
        'Error while saving inventory records to the database',
      );

      expect(mockInventoryRepo.create).toHaveBeenCalledWith(mockPayload.data);
      expect(mockInventoryRepo.insert).toHaveBeenCalledWith(mockPayload.data);
    });
  });

  describe('operate', () => {
    it('should process DATA_INSERT type payload', async () => {
      jest.spyOn(service, 'createInventory').mockResolvedValueOnce(undefined);

      await service.operate(mockPayload);

      expect(service.createInventory).toHaveBeenCalledWith(mockPayload.data);
    });

    it('should process DISCOVERY_COMPLETED type payload', async () => {
      const discoveryPayload = {
        type: InventoryPayloadType.DISCOVERY_COMPLETED,
        data: { jobId: '1234', timestamp: new Date().toISOString() },
      } as InventoryPayload;
      jest.spyOn(service, 'notifyDiscoveryCompleted').mockResolvedValueOnce(undefined);

      await service.operate(discoveryPayload);

      expect(service.notifyDiscoveryCompleted).toHaveBeenCalledWith(discoveryPayload.data);
    });

    it('should throw an error for invalid type', async () => {
      const invalidPayload = { type: 'INVALID', data: [] } as any;

      await expect(service.operate(invalidPayload)).rejects.toThrow('Invalid Type');
    });
  });
  
});
