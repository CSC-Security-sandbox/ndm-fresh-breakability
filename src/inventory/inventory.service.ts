import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateInventoryDto } from '../dto/create-inventory.dto';
import { UpdateInventoryDto } from 'src/dto/update-inventory.dto';
import { InventoryEntity } from '../entities/inventory.entity';

@Injectable()
export class InventoryService {
    private readonly logger = new Logger(InventoryService.name);

    constructor(
        @InjectRepository(InventoryEntity)
        private readonly inventoryRepo: Repository<InventoryEntity>,
    ) { }

    private async findInventoryById(id: string): Promise<InventoryEntity> {
        const inventory = await this.inventoryRepo.findOne({ where: { id } });
        if (!inventory) {
            throw new NotFoundException(`Inventory with ID ${id} not found`);
        }
        return inventory;
    }

    async createInventory(data: CreateInventoryDto[]): Promise<InventoryEntity[]> {
        try {
            const inventoryRecords = this.inventoryRepo.create(data);
            return await this.inventoryRepo.save(inventoryRecords);
        } catch (err) {
            this.logger.error(`Failed to save inventory records: ${err.message}`, err.stack);
            throw new Error('Error while saving inventory records to the database');
        }
    }

    async getInventoryById(id: string): Promise<InventoryEntity> {
        return this.findInventoryById(id);
    }

    async updateInventory(id: string, data: UpdateInventoryDto): Promise<InventoryEntity> {
        const inventory = await this.findInventoryById(id);

        Object.assign(inventory, data);

        try {
            return await this.inventoryRepo.save(inventory);
        } catch (err) {
            this.logger.error(`Failed to update inventory: ${err.message}`, err.stack);
            throw new Error('Error while updating inventory in the database');
        }
    }

    async deleteInventory(id: string): Promise<{ message: string }> {
        const inventory = await this.findInventoryById(id);

        try {
            await this.inventoryRepo.remove(inventory);
            return { message: `Inventory with ID ${id} has been deleted` };
        } catch (err) {
            this.logger.error(`Failed to delete inventory: ${err.message}`, err.stack);
            throw new Error('Error while deleting inventory from the database');
        }
    }

    async getAllInventories(): Promise<InventoryEntity[]> {
        try {
            return await this.inventoryRepo.find();
        } catch (err) {
            this.logger.error(`Failed to retrieve inventories: ${err.message}`, err.stack);
            throw new Error('Error while fetching inventories');
        }
    }

}
