import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { Repository } from 'typeorm';
import { Account } from '../entities/account.entity';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { UserPermissionResponse } from 'src/auth/user-permission-response-type';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';

describe('AccountController', () => {
  let controller: AccountController;
  let service: AccountService;

  const mockJwtService = {
    verifyToken: jest.fn().mockResolvedValue({
      user: {
        roles: [
          {
            permissions: ['permission1', 'permission2'],
            projects: ['project1'],
          },
        ],
      },
    }),
    configService: {},
    client: jest.fn(),
    logger: jest.fn(),
    getKey: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [
        AccountService,
        {
          provide: getRepositoryToken(Account),
          useClass: Repository,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    controller = module.get<AccountController>(AccountController);
    service = module.get<AccountService>(AccountService);
  });

  const userPermissionResponseMock = {
    user: {
      roles: [
        {
          role_name: "",
          projects: [],
          permissions: []
        }
      ],
      id: "6d4657c8-b19a-47b4-bb2e-bcef5865d4ca" // can be replaced with any string
    }
  } as UserPermissionResponse

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should create an account', async () => {
    const createAccountDto = { account_name: 'test' };
    const account = {
      id: '1',
      ...createAccountDto,
      created_at: new Date(),
      created_by: '1',
      updated_at: new Date(),
      updated_by: '1',
      user_roles: [],
      projects: [],
      populateWhoColumns: jest.fn(),
    } as Account;

    jest.spyOn(service, 'create').mockResolvedValue(account);

    expect(await controller.create(createAccountDto, userPermissionResponseMock)).toEqual(account);
  });

  it('should find all accounts', async () => {
    const accounts = [
      {
        id: '1',
        account_name: 'test',
        created_at: new Date(),
        created_by: '1',
        updated_at: new Date(),
        updated_by: '1',
        user_roles: [],
        projects: [],
        populateWhoColumns: jest.fn(),
      } as Account,
      {
        id: '2',
        account_name: 'test2',
        created_at: new Date(),
        created_by: '1',
        updated_at: new Date(),
        updated_by: '1',
        user_roles: [],
        projects: [],
        populateWhoColumns: jest.fn(),
      } as Account,
    ];

    jest.spyOn(service, 'findAll').mockResolvedValue(accounts);

    expect(await controller.findAll(1, 10, 'id', 'ASC', '{}')).toEqual(accounts);
  });

  it('should find one account by id', async () => {
    const account = {
      id: '1',
      account_name: 'test',
      created_at: new Date(),
      created_by: '1',
      updated_at: new Date(),
      updated_by: '1',
      user_roles: [],
      projects: [],
      populateWhoColumns: jest.fn(),
    } as Account;

    jest.spyOn(service, 'findOne').mockResolvedValue(account);

    expect(await controller.findOne('1')).toEqual(account);
  });

  it('should update an account', async () => {
    const updateAccountDto = { account_name: 'test' };

    jest.spyOn(service, 'update').mockResolvedValue();

    expect(await controller.update('1', updateAccountDto, userPermissionResponseMock)).toBeUndefined();
  });

  it('should throw NotFoundException when updating a non-existent account', async () => {
    const updateAccountDto = { account_name: 'updated test' };
    const id = 'non-existent-id';

    jest.spyOn(service, 'update').mockRejectedValue(new NotFoundException('Account not found'));

    await expect(controller.update(id, updateAccountDto, userPermissionResponseMock)).rejects.toThrow(NotFoundException);
  });

  it('should throw BadRequestException if input data is invalid', async () => {
    const invalidAccountDto = {} as Account; 

    jest.spyOn(service, 'create').mockRejectedValue(new BadRequestException('Invalid input'));

    await expect(controller.create(invalidAccountDto, userPermissionResponseMock)).rejects.toThrow(BadRequestException);
  });

  it('should delete an account', async () => {
    jest.spyOn(service, 'delete').mockResolvedValue();

    expect(await controller.delete('1')).toBeUndefined();
  });

  it('should throw NotFoundException when deleting a non-existent account', async () => {
    const id = 'non-existent-id';
    jest.spyOn(service, 'delete').mockRejectedValue(new NotFoundException('Account not found'));

    await expect(controller.delete(id)).rejects.toThrow(NotFoundException);
  });

  it('should use default query parameters when none are provided', async () => {
    const accounts = [];
    jest.spyOn(service, 'findAll').mockResolvedValue(accounts);


    expect(await controller.findAll(1, 10, 'id', 'ASC', '{}')).toEqual(accounts);
    expect(await controller.findAll(undefined, 10, 'id', 'ASC', '{}')).toEqual(accounts);
    expect(await controller.findAll(undefined, undefined, 'id', 'ASC', '{}')).toEqual(accounts);
    expect(await controller.findAll(undefined, undefined, undefined, 'ASC', '{}')).toEqual(accounts);
    expect(await controller.findAll(undefined, undefined, undefined, undefined, '{}')).toEqual(accounts);
    expect(await controller.findAll(undefined, undefined, undefined, undefined, undefined)).toEqual(accounts);


    expect(service.findAll).toHaveBeenCalledWith(1, 10, 'id', 'ASC', {});
  });
   
  it('should accept query parameters and pass them to the service', async () => {
    const accounts = [];
    jest.spyOn(service, 'findAll').mockResolvedValue(accounts);
   
    const page = 2;
    const limit = 5;
    const sortField = 'account_name';
    const sortOrder = 'DESC';
    const filter = JSON.stringify({ key: 'value' });
   
    expect(await controller.findAll(page, limit, sortField, sortOrder, filter)).toEqual(accounts);
    expect(service.findAll).toHaveBeenCalledWith(page, limit, sortField, sortOrder, { key: 'value' });
  });
   
  it('should handle null filter gracefully', async () => {
    const accounts = [];
    jest.spyOn(service, 'findAll').mockResolvedValue(accounts);
   
    expect(await controller.findAll(1, 10, 'id', 'ASC', null)).toEqual(accounts);
    expect(service.findAll).toHaveBeenCalledWith(1, 10, 'id', 'ASC', {});
  });
});