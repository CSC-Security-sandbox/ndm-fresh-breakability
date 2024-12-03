import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateInventoryDto } from '../dto/create-inventory.dto';
import { InventoryEntity } from '../entities/inventory.entity';
import { Repository } from 'typeorm';
import { UpdateInventoryDto } from 'src/dto/update-inventory.dto';

@Injectable()
export class InventoryService {

    constructor(
        @InjectRepository(InventoryEntity)
        private inventoryRepo: Repository<InventoryEntity>
    ) { }

    async createInventory(data: CreateInventoryDto) {
        try {            
            const inventoryRecord = this.inventoryRepo.create({
                pathId: data?.pathId,
                fileName: data?.fileName,
                path: data?.path,
                parentPath: data?.parentPath,
                jobRunId: data?.jobRunId,
                isFolder: data?.isFolder,
                uid: data?.uid,
                gid: data?.gid,
                size: data?.size,
                mtime: data?.mtime,
                birthtime: data?.birthtime,
                extension: data?.extension,
                permission: data?.permission,
                atime: data?.atime,
                sourceChecksum: null,
                targetChecksum: null,
                status: data?.status,
                depth: data?.depth
            });
            return this.inventoryRepo.save(inventoryRecord);
        } catch (err) {
            Logger.log(`Error while saving data in the db - ${JSON.stringify(err)}`);
        }
    }

    async getInventoryById(id: string) {
        const inventory = await this.inventoryRepo.findOne({ where: { id } });
        if (!inventory) {
            throw new Error(`Inventory with id ${id} not found`);
        }
        return inventory;
    }

    async updateInventory(id: string, data: UpdateInventoryDto) {
        const inventory = await this.inventoryRepo.findOne({ where: { id } });
        if (!inventory) {
            throw new Error(`Inventory with id ${id} not found`);
        }

        inventory.fileName = data?.fileName ?? inventory.fileName;
        inventory.path = data?.path ?? inventory.path;
        inventory.parentPath = data?.parentPath ?? inventory.parentPath;
        inventory.isFolder = data?.isFolder ?? inventory.isFolder;
        inventory.uid = data?.uid ?? inventory.uid;
        inventory.gid = data?.gid ?? inventory.gid;
        inventory.size = data?.size ?? inventory.size;
        inventory.mtime = data?.mtime ?? inventory.mtime;
        inventory.birthtime = data?.birthtime ?? inventory.birthtime;
        inventory.extension = data?.extension ?? inventory.extension;
        inventory.permission = data?.permission ?? inventory.permission;
        inventory.atime = data?.atime ?? inventory.atime;
        inventory.sourceChecksum = data?.sourceChecksum ?? inventory.sourceChecksum;
        inventory.targetChecksum = data?.targetChecksum ?? inventory.targetChecksum;
        inventory.status = data?.status ?? inventory.status;
        inventory.depth = data?.depth ?? inventory.depth;

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
