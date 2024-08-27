// src/controllers/inventory.controller.ts
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
import { Inventory } from '../schemas/inventory.schema';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  async createInventory(@Body() data: Partial<Inventory>): Promise<Inventory> {
    return await this.inventoryService.createInventory(data);
  }

  @Get(':id')
  async getInventoryById(@Param('id') id: string): Promise<Inventory | null> {
    return await this.inventoryService.getInventoryById(id);
  }

  @Put(':id')
  async updateInventory(
    @Param('id') id: string,
    @Body() data: Partial<Inventory>,
  ): Promise<Inventory | null> {
    return await this.inventoryService.updateInventory(id, data);
  }

  @Delete(':id')
  async deleteInventory(@Param('id') id: string): Promise<Inventory | null> {
    return await this.inventoryService.deleteInventory(id);
  }

  @Get()
  async getAllInventories(): Promise<Inventory[]> {
    return await this.inventoryService.getAllInventories();
  }
}
