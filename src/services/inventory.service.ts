import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createInventoryDTO } from '../dto/create-inventory.dto';
import { InventoryEntity } from '../entities/inventory.entity';
import { Repository } from 'typeorm';
import { TaskEntity } from 'src/entities/task.entity';

@Injectable()
export class InventoryService {

  constructor(
    @InjectRepository(InventoryEntity)
    private inventoryRepo: Repository<InventoryEntity>
  ) {}

  async createInventory(data: createInventoryDTO) {
    try{
      const inventoryRecord = this.inventoryRepo.create({
        mount_path: data?.mountPath,
        file_server: data?.fileServer,
        file_name: data?.fileName,
        parent_path: data.parentPath,
        type: data?.type,
        metadata: data?.metadata
      });
      return this.inventoryRepo.save(inventoryRecord);
    } catch(err) {
      console.log(`Error while saving data in the db - ${err}`);
    }
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
    inventory.type = data.type ?? inventory.type;
    inventory.metadata = data.metadata ?? inventory.metadata;
  
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
