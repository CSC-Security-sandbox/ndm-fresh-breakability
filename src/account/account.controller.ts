import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { AccountService } from './account.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AccountDescription } from '../swagger/swagger-summary';

@ApiTags('accounts')
@Controller('/api/v1/accounts')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Post()
  @ApiBody({ type: CreateAccountDto })
  @ApiOperation({
    summary: 'Create Account',
    description: AccountDescription.CreateAccountDescription,
  })
  create(@Body() createAccountDto: CreateAccountDto) {
    return this.accountService.create(createAccountDto);
  }

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

  @Get(':id')
  @ApiOperation({
    summary: 'Get Account by account id',
    description: AccountDescription.getAccountByIdDescription,
  })
  findOne(@Param('id') id: string) {
    return this.accountService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update Account',
    description: AccountDescription.UpdateAccountDescription,
  })
  update(@Param('id') id: string, @Body() updateAccountDto: UpdateAccountDto) {
    return this.accountService.update(id, updateAccountDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete Account',
    description: AccountDescription.DeleteAccountDescription,
  })
  delete(@Param('id') id: string) {
    return this.accountService.delete(id);
  }
}
