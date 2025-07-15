import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { Account } from '../entities/account.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { UserPermissionResponse } from '../auth/user-permission-response-type';

@Injectable()
export class AccountService {
  constructor(
    @InjectRepository(Account)
    private accountRepository: Repository<Account>,
  ) {}

  create(
    createAccountDto: CreateAccountDto,
    userPermissions: UserPermissionResponse,
  ): Promise<Account> {
    const account = this.accountRepository.create(createAccountDto);
    account.populateWhoColumns(userPermissions.user.id);
    return this.accountRepository.save(account);
  }

  findAll(
    page: number = 1,
    limit: number = 10,
    sortField: string = 'id',
    sortOrder: 'ASC' | 'DESC' = 'ASC',
    filter: Partial<CreateAccountDto> = {},
  ): Promise<Account[]> {
    const options: FindManyOptions<Account> = {
      skip: (page - 1) * limit,
      take: limit,
      order: {
        [sortField]: sortOrder,
      },
      where: filter,
    };
    return this.accountRepository.find(options);
  }

  async findOne(id: string): Promise<Account> {
    return await this.accountRepository.findOneBy({ id: id });
  }

  async update(
    id: string,
    updateAccountDto: UpdateAccountDto,
    userPermissionResponse: UserPermissionResponse,
  ): Promise<void> {
    await this.accountRepository.update(id, {
      ...updateAccountDto,
      updated_by: userPermissionResponse.user.id,
    });
  }

  async delete(id: string): Promise<void> {
    await this.accountRepository.delete(id);
  }
}
