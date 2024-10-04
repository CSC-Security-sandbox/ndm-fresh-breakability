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
    const inventoryRecord = this.inventoryRepo.create({
      mount_path: data?.mountPath,
      file_server: data?.fileServer,
      file_name: data?.fileName,
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
  
    inventory.mount_path = data.mountPath ?? inventory.mount_path;
    inventory.file_server = data.fileServer ?? inventory.file_server;
    inventory.file_name = data.fileName ?? inventory.file_name;
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
