// src/services/inventory.service.ts
import { InjectModel } from '@nestjs/mongoose';
import { InventoryModel, Inventory } from '../schemas/inventory.schema';
import { Model } from 'mongoose';

export class InventoryService {

  constructor(
    @InjectModel('Inventory') private readonly inventoryModel: Model<Inventory>
  ) {}

  async createInventory(data: Partial<Inventory>): Promise<Inventory> {
    const inventory = new this.inventoryModel(data);
    return await inventory.save();
  }

  async getInventoryById(id: string): Promise<Inventory | null> {
    return await this.inventoryModel.findById(id).exec();
  }

  async updateInventory(
    id: string,
    data: Partial<Inventory>,
  ): Promise<Inventory | null> {
    return await this.inventoryModel.findByIdAndUpdate(id, data, {
      new: true,
    }).exec();
  }

  async deleteInventory(id: string): Promise<Inventory | null> {
    return await this.inventoryModel.findByIdAndDelete(id).exec();
  }

  async getAllInventories(): Promise<Inventory[]> {
    return await this.inventoryModel.find().exec();
  }
}
