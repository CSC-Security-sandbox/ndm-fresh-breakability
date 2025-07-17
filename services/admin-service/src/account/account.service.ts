import {
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { Account } from '../entities/account.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import {
  LoggerFactory,
  LoggerService
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class AccountService {
  private readonly logger: LoggerService;
  constructor(
    @InjectRepository(Account)
    private accountRepository: Repository<Account>,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(AccountService.name);
  }

  async create(
    createAccountDto: CreateAccountDto,
    userPermissions: UserPermissionResponse,
  ): Promise<Account> {
    try {
      this.logger.log('Creating new account', {
        userId: userPermissions.user.id,
        accountData: createAccountDto
      });

      const account = this.accountRepository.create(createAccountDto);
      account.populateWhoColumns(userPermissions.user.id);
      const savedAccount = await this.accountRepository.save(account);

      this.logger.log('Account created successfully', {
        accountId: savedAccount.id,
        userId: userPermissions.user.id
      });

      return savedAccount;
    } catch (error) {
      this.logger.error('Failed to create account for user', error);
      throw error;
    }
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    sortField: string = 'id',
    sortOrder: 'ASC' | 'DESC' = 'ASC',
    filter: Partial<CreateAccountDto> = {},
  ): Promise<Account[]> {
    try {
      this.logger.log('Retrieving accounts list', {
        page,
        limit,
        sortField,
        sortOrder
      });

      const options: FindManyOptions<Account> = {
        skip: (page - 1) * limit,
        take: limit,
        order: {
          [sortField]: sortOrder,
        },
        where: filter,
      };

      const accounts = await this.accountRepository.find(options);

      this.logger.log('Successfully retrieved accounts', {
        count: accounts.length,
        page,
        limit
      });
      return accounts;
    } catch (error) {
      this.logger.error('Failed to retrieve accounts list', error);
      throw error;
    }
  }

  async findOne(id: string): Promise<Account> {
    try {
      this.logger.log(`Retrieving account by ID: ${id}`);

      const account = await this.accountRepository.findOneBy({ id: id });

      if (!account) {
        this.logger.warn('Account not found', { accountId: id });
        throw new NotFoundException(`Account with ID ${id} not found`);
      }

      this.logger.log('Successfully retrieved account', { accountId: id });
      return account;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to retrieve account', error);
      throw error;
    }
  }

  async update(
    id: string,
    updateAccountDto: UpdateAccountDto,
    userPermissionResponse: UserPermissionResponse,
  ): Promise<void> {
    try {
      this.logger.log('Updating account', {
        accountId: id,
        userId: userPermissionResponse.user.id
      });

      // Check if account exists first
      const existingAccount = await this.accountRepository.findOneBy({ id });
      if (!existingAccount) {
        this.logger.warn('Account not found for update', { accountId: id });
        throw new NotFoundException(`Account with ID ${id} not found`);
      }

      await this.accountRepository.update(id, {
        ...updateAccountDto,
        updated_by: userPermissionResponse.user.id,
      });

      this.logger.log('Successfully updated account', { accountId: id });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to update account', error);
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      this.logger.log('Deleting account', { accountId: id });

      // Check if account exists first
      const existingAccount = await this.accountRepository.findOneBy({ id });
      if (!existingAccount) {
        this.logger.warn('Account not found for deletion', { accountId: id });
        throw new NotFoundException(`Account with ID ${id} not found`);
      }

      await this.accountRepository.delete(id);

      this.logger.log('Successfully deleted account', { accountId: id });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to delete account', error);
      throw error;
    }
  }
}
