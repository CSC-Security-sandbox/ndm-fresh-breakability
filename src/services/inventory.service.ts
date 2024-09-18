// src/services/inventory.service.ts
import { InjectModel } from '@nestjs/mongoose';
import { Inventory } from '../schemas/inventory.schema';
import { Model } from 'mongoose';

export class InventoryService {

  constructor(
    @InjectModel('Inventory') private readonly inventory: Model<Inventory>
  ) {}

  // async createInventory(data: Partial<Inventory>): Promise<Inventory> {
  //   const inventory = new this.inventory(data);
  //   return await inventory.save();
  // }

  async createInventory(data: Partial<Inventory>): Promise<Inventory> {
    console.log(`Data to create inventory - ${JSON.stringify(data)}`);
    return await this.inventory.create(data);
  }

  async getInventoryById(id: string): Promise<Inventory | null> {
    return await this.inventory.findById(id).exec();
  }

  async updateInventory(
    id: string,
    data: Partial<Inventory>,
  ): Promise<Inventory | null> {
    return await this.inventory.findByIdAndUpdate(id, data, {
      new: true,
    }).exec();
  }

  async deleteInventory(id: string): Promise<Inventory | null> {
    return await this.inventory.findByIdAndDelete(id).exec();
  }

  async getAllInventories(): Promise<Inventory[]> {
    return await this.inventory.find().exec();
  }
}
