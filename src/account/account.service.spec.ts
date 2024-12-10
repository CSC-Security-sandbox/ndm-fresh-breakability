import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountService } from './account.service';
import { Account } from '../entities/account.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { randomUUID } from 'crypto';
import { Project } from '../entities/project.entity';
import { UserPermissionResponse } from 'src/auth/user-permission-response-type';

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
      ],
    }).compile();

    service = module.get<AccountService>(AccountService);
    repository = module.get<Repository<Account>>(getRepositoryToken(Account));
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

    expect(await service.create(createAccountDto, userPermissionResponseMock)).toEqual(account);
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

    

    jest.spyOn(repository, 'update').mockResolvedValue(undefined);

    await service.update('1', updateAccountDto, userPermissionResponseMock);
    expect(repository.update).toHaveBeenCalledWith('1', {
      ...updateAccountDto,
      updated_by: expect.any(String),
    });
  });

  it('should delete an account', async () => {
    jest.spyOn(repository, 'delete').mockResolvedValue(undefined);

    await service.delete('1');
    expect(repository.delete).toHaveBeenCalledWith('1');
  });
});
