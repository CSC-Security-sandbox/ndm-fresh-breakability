import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createInventoryDTO } from '../dto/create-inventory.dto';
import { InventoryEntity } from '../entities/inventory.entity';
import { Repository } from 'typeorm';

@Injectable()
export class InventoryService {

  constructor(
    @InjectRepository(InventoryEntity)
    private inventoryRepo: Repository<InventoryEntity>,
  ) {}

  async createInventory(data: createInventoryDTO) {
    console.log(`Data to create inventory - ${JSON.stringify(data)}`);
    const inventoryRecord = this.inventoryRepo.create({
      mountPath: data?.mountPath,
      fileServer: data?.fileServer,
      fileName: data?.fileName,
      folder: data?.folder,
      metadata: JSON.stringify(data?.metadata)
    });

    return this.inventoryRepo.save(inventoryRecord);
  }

  async getInventoryById(id: string) {
    const inventory = await this.inventoryRepo.findOne({ where: { id } });
    if (!inventory) {
      throw new Error(`Inventory with id ${id} not found`);
    }
    return inventory;
  }
  
  async updateInventory(id: string, data: createInventoryDTO) {
    const inventory = await this.inventoryRepo.findOne({ where: { id } });
    if (!inventory) {
      throw new Error(`Inventory with id ${id} not found`);
    }
  
    inventory.mountPath = data.mountPath ?? inventory.mountPath;
    inventory.fileServer = data.fileServer ?? inventory.fileServer;
    inventory.fileName = data.fileName ?? inventory.fileName;
    inventory.folder = data.folder ?? inventory.folder;
    inventory.metadata = JSON.stringify(data.metadata ?? inventory.metadata);
  
    return this.inventoryRepo.save(inventory);
  }
  
  async deleteInventory(id: string) {
    const inventory = await this.inventoryRepo.findOne({ where: { id } });
    if (!inventory) {
      throw new Error(`Inventory with id ${id} not found`);
    }
  
    await this.inventoryRepo.remove(inventory);
    return { message: `Inventory with id ${id} has been deleted` };
  }
  
  async getAllInventories() {
    return await this.inventoryRepo.find();
  }
  
}
