import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { AccountService } from './account.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AccountDescription } from '../swagger/swagger-summary';
import { Auth } from '@netapp-cloud-datamigrate/auth-lib';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import { NonEmptyStringPipe } from '../utils/pipes/non-empty-string';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@ApiTags('accounts')
@Controller('/api/v1/accounts')
export class AccountController {
  private readonly logger: LoggerService;

  constructor(
    private readonly accountService: AccountService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(AccountController.name);
  }

  @Auth()
  @ApiBearerAuth()
  @Post()
  @ApiBody({ type: CreateAccountDto })
  @ApiOperation({
    summary: 'Create Account',
    description: AccountDescription.CreateAccountDescription,
  })
  create(
    @Body() createAccountDto: CreateAccountDto,
    @Request() userPermissions: UserPermissionResponse,
  ) {
    this.logger.log('Create account request received', {
      userId: userPermissions.user.id,
    });
    return this.accountService.create(createAccountDto, userPermissions);
  }

  @Auth()
  @ApiBearerAuth()
  @Get()
  @ApiOperation({
    summary: 'Get Page of Account List',
    description: AccountDescription.GetAllAccountsDescription,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of items per page',
  })
  @ApiQuery({
    name: 'sortField',
    required: false,
    type: String,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: ['ASC', 'DESC'],
    description: 'Sort order',
  })
  @ApiQuery({
    name: 'filter',
    required: false,
    type: String,
    description: 'Filter conditions',
  })
  findAll(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('sortField') sortField: string = 'id',
    @Query('sortOrder') sortOrder: 'ASC' | 'DESC' = 'ASC',
    @Query('filter') filter: string,
  ) {
    this.logger.log('GET All Accounts request', {
      page,
      limit,
      sortField,
      sortOrder,
    });
    let parsedFilter = {};
    if (filter != null) {
      try {
        parsedFilter = JSON.parse(filter);
      } catch {
        throw new BadRequestException('Invalid filter JSON');
      }
    }
    return this.accountService.findAll(
      page,
      limit,
      sortField,
      sortOrder,
      parsedFilter,
    );
  }

  @Auth()
  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({
    summary: 'Get Account by account id',
    description: AccountDescription.getAccountByIdDescription,
  })
  findOne(@Param('id', NonEmptyStringPipe) id: string) {
    this.logger.log('GET Account by ID request', { accountId: id });
    return this.accountService.findOne(id);
  }

  @Auth()
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({
    summary: 'Update Account',
    description: AccountDescription.UpdateAccountDescription,
  })
  update(
    @Param('id', NonEmptyStringPipe) id: string,
    @Body() updateAccountDto: UpdateAccountDto,
    @Request() userPermissionResponse: UserPermissionResponse,
  ) {
    this.logger.log('UPDATE Account request', {
      accountId: id,
      userId: userPermissionResponse.user.id,
    });
    return this.accountService.update(
      id,
      updateAccountDto,
      userPermissionResponse,
    );
  }

  @Auth()
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete Account',
    description: AccountDescription.DeleteAccountDescription,
  })
  delete(@Param('id', NonEmptyStringPipe) id: string) {
    this.logger.log('DELETE Account request', { accountId: id });
    return this.accountService.delete(id);
  }
}
