import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { AccountService } from './account.service';
import { Account } from '../entities/account.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { randomUUID } from 'crypto';
import { Project } from '../entities/project.entity';
import { UserPermissionResponse } from 'src/auth/user-permission-response-type';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from '../test-utils/logger-mocks';

describe('AccountService', () => {
  let service: AccountService;
  let repository: Repository<Account>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        {
          provide: getRepositoryToken(Account),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(Project),
          useClass: Repository,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    })
    .overrideProvider(LoggerFactory)
    .useValue(mockLoggerFactory)
    .compile();

    service = module.get<AccountService>(AccountService);
    repository = module.get<Repository<Account>>(getRepositoryToken(Account));
  });

  const userPermissionResponseMock = {
    user: {
      roles: [
        {
          role_name: '',
          projects: [],
          permissions: [],
        },
      ],
      id: '6d4657c8-b19a-47b4-bb2e-bcef5865d4ca', // can be replaced with any string
    },
  } as UserPermissionResponse;

  it('should create an account', async () => {
    const createAccountDto: CreateAccountDto = { account_name: 'test' };
    const account = {
      id: '1',
      ...createAccountDto,
      created_at: new Date(),
      created_by: randomUUID(),
      updated_at: new Date(),
      updated_by: randomUUID(),
      user_roles: [],
      projects: [],
      populateWhoColumns: jest.fn(),
    } as Account;

    jest.spyOn(repository, 'create').mockReturnValue(account);
    jest.spyOn(repository, 'save').mockResolvedValue(account);

    expect(
      await service.create(createAccountDto, userPermissionResponseMock),
    ).toEqual(account);
    expect(repository.create).toHaveBeenCalledWith(createAccountDto);
    expect(repository.save).toHaveBeenCalledWith(account);
  });

  it('should find all accounts', async () => {
    const accounts = [
      {
        id: '1',
        account_name: 'test',
        created_at: new Date(),
        created_by: randomUUID(),
        updated_at: new Date(),
        updated_by: randomUUID(),
        user_roles: [],
        projects: [],
        populateWhoColumns: jest.fn(),
      } as Account,
      {
        id: '2',
        account_name: 'test2',
        created_at: new Date(),
        created_by: randomUUID(),
        updated_at: new Date(),
        updated_by: randomUUID(),
        user_roles: [],
        projects: [],
        populateWhoColumns: jest.fn(),
      } as Account,
    ];

    jest.spyOn(repository, 'find').mockResolvedValue(accounts);

    expect(await service.findAll()).toEqual(accounts);
    expect(repository.find).toHaveBeenCalled();
  });

  it('should find one account by id', async () => {
    const account = {
      id: '1',
      account_name: 'test',
      created_at: new Date(),
      created_by: randomUUID(),
      updated_at: new Date(),
      updated_by: randomUUID(),
      user_roles: [],
      projects: [],
      populateWhoColumns: jest.fn(),
    } as Account;

    jest.spyOn(repository, 'findOneBy').mockResolvedValue(account);

    expect(await service.findOne('1')).toEqual(account);
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: '1' });
  });

  it('should update an account', async () => {
    const updateAccountDto: UpdateAccountDto = { account_name: 'test' };
    const existingAccount = {
      id: '1',
      account_name: 'existing account',
    } as Account;

    jest.spyOn(repository, 'findOneBy').mockResolvedValue(existingAccount);
    jest.spyOn(repository, 'update').mockResolvedValue(undefined);

    await service.update('1', updateAccountDto, userPermissionResponseMock);
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: '1' });
    expect(repository.update).toHaveBeenCalledWith('1', {
      ...updateAccountDto,
      updated_by: expect.any(String),
    });
  });

  it('should delete an account', async () => {
    const existingAccount = {
      id: '1',
      account_name: 'existing account',
    } as Account;

    jest.spyOn(repository, 'findOneBy').mockResolvedValue(existingAccount);
    jest.spyOn(repository, 'delete').mockResolvedValue(undefined);

    await service.delete('1');
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: '1' });
    expect(repository.delete).toHaveBeenCalledWith('1');
  });

  // Error scenario tests for better coverage
  describe('Error Scenarios', () => {
    it('should handle database error during account creation', async () => {
      const createAccountDto: CreateAccountDto = { account_name: 'test' };
      const mockError = new Error('Database connection failed');
      const mockAccount = {
        populateWhoColumns: jest.fn(),
      } as any;

      jest.spyOn(repository, 'create').mockReturnValue(mockAccount);
      jest.spyOn(repository, 'save').mockRejectedValue(mockError);

      await expect(service.create(createAccountDto, userPermissionResponseMock))
        .rejects.toThrow('Database connection failed');
    });

    it('should handle database error during findAll', async () => {
      const mockError = new Error('Database connection failed');

      jest.spyOn(repository, 'find').mockRejectedValue(mockError);

      await expect(service.findAll()).rejects.toThrow('Database connection failed');
    });

    it('should handle database error during findOne', async () => {
      const mockError = new Error('Database connection failed');

      jest.spyOn(repository, 'findOneBy').mockRejectedValue(mockError);

      await expect(service.findOne('1')).rejects.toThrow('Database connection failed');
    });

    it('should handle database error during update', async () => {
      const updateAccountDto: UpdateAccountDto = { account_name: 'test' };
      const existingAccount = { id: '1', account_name: 'existing' } as Account;
      const mockError = new Error('Database connection failed');

      jest.spyOn(repository, 'findOneBy').mockResolvedValue(existingAccount);
      jest.spyOn(repository, 'update').mockRejectedValue(mockError);

      await expect(service.update('1', updateAccountDto, userPermissionResponseMock))
        .rejects.toThrow('Database connection failed');
    });

    it('should handle database error during delete', async () => {
      const existingAccount = { id: '1', account_name: 'existing' } as Account;
      const mockError = new Error('Database connection failed');

      jest.spyOn(repository, 'findOneBy').mockResolvedValue(existingAccount);
      jest.spyOn(repository, 'delete').mockRejectedValue(mockError);

      await expect(service.delete('1')).rejects.toThrow('Database connection failed');
    });

    it('should handle findOneBy error during update', async () => {
      const updateAccountDto: UpdateAccountDto = { account_name: 'test' };
      const mockError = new Error('Database connection failed');

      jest.spyOn(repository, 'findOneBy').mockRejectedValue(mockError);

      await expect(service.update('1', updateAccountDto, userPermissionResponseMock))
        .rejects.toThrow('Database connection failed');
    });

    it('should handle findOneBy error during delete', async () => {
      const mockError = new Error('Database connection failed');

      jest.spyOn(repository, 'findOneBy').mockRejectedValue(mockError);

      await expect(service.delete('1')).rejects.toThrow('Database connection failed');
    });
  });

  // Not found scenario tests
  describe('Not Found Scenarios', () => {
    it('should throw NotFoundException when account not found in findOne', async () => {
      jest.spyOn(repository, 'findOneBy').mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id'))
        .rejects.toThrow(NotFoundException);
      await expect(service.findOne('nonexistent-id'))
        .rejects.toThrow('Account with ID nonexistent-id not found');
    });

    it('should throw NotFoundException when account not found for update', async () => {
      const updateAccountDto: UpdateAccountDto = { account_name: 'test' };

      jest.spyOn(repository, 'findOneBy').mockResolvedValue(null);

      await expect(service.update('nonexistent-id', updateAccountDto, userPermissionResponseMock))
        .rejects.toThrow(NotFoundException);
      await expect(service.update('nonexistent-id', updateAccountDto, userPermissionResponseMock))
        .rejects.toThrow('Account with ID nonexistent-id not found');
    });

    it('should throw NotFoundException when account not found for delete', async () => {
      jest.spyOn(repository, 'findOneBy').mockResolvedValue(null);

      await expect(service.delete('nonexistent-id'))
        .rejects.toThrow(NotFoundException);
      await expect(service.delete('nonexistent-id'))
        .rejects.toThrow('Account with ID nonexistent-id not found');
    });
  });
});
