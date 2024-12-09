import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Request,
} from '@nestjs/common';
import { AccountService } from './account.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AccountDescription } from '../swagger/swagger-summary';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import { UserPermissionResponse } from 'src/auth/auth-user.type';

@ApiTags('accounts')
@Controller('/api/v1/accounts')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Auth()
  @ApiBearerAuth()
  @Post()
  @ApiBody({ type: CreateAccountDto })
  @ApiOperation({
    summary: 'Create Account',
    description: AccountDescription.CreateAccountDescription,
  })
  create(@Body() createAccountDto: CreateAccountDto, @Request() userPermissions:UserPermissionResponse) {
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
    return this.accountService.findAll(
      page,
      limit,
      sortField,
      sortOrder,
      filter != null ? JSON.parse(filter) : {},
    );
  }

  @Auth()
  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({
    summary: 'Get Account by account id',
    description: AccountDescription.getAccountByIdDescription,
  })
  findOne(@Param('id') id: string) {
    return this.accountService.findOne(id);
  }

  @Auth()
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({
    summary: 'Update Account',
    description: AccountDescription.UpdateAccountDescription,
  })
  update(@Param('id') id: string, @Body() updateAccountDto: UpdateAccountDto, @Request() userPermissionResponse: UserPermissionResponse) {
    return this.accountService.update(id, updateAccountDto, userPermissionResponse);
  }

  @Auth()
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete Account',
    description: AccountDescription.DeleteAccountDescription,
  })
  delete(@Param('id') id: string) {
    return this.accountService.delete(id);
  }
}
