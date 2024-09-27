import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { InventoryService } from '../services/inventory.service';
import { createInventoryDTO } from '../dto/create-inventory.dto';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  async createInventory(@Body() data: createInventoryDTO ) {
    return await this.inventoryService.createInventory(data);
  }

  @Get(':id')
  async getInventoryById(@Param('id') id: string) {
    return await this.inventoryService.getInventoryById(id);
  }

  @Put(':id')
  async updateInventory(
    @Param('id') id: string,
    @Body() data,
  ) {
    return await this.inventoryService.updateInventory(id, data);
  }

  @Delete(':id')
  async deleteInventory(@Param('id') id: string) {
    return await this.inventoryService.deleteInventory(id);
  }

  @Get()
  async getAllInventories() {
    return await this.inventoryService.getAllInventories();
  }
}
