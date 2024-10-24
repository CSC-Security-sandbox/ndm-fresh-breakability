import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as path from 'path';
import { InventoryEntity } from '../entities/inventory.entity';
import { Repository } from 'typeorm';

@Injectable()
export class DiscoveryService {
    constructor(
        @InjectRepository(InventoryEntity)
        private readonly inventoryRepo: Repository<InventoryEntity>,
    ) {}

    async getDiscoveryByFileServerId(fileServerId: string) {
        const singleRecord = await this.inventoryRepo.findOne({
            where: { file_server: fileServerId }
        });

        const data = await this.getDataFromParentPath(fileServerId, singleRecord.mount_path);
        const transformedData = data.map((item) => ({
            ...item,
            childs: []
        }));
        
        return [{
            root: path.basename(singleRecord.mount_path),
            childs: transformedData,
        }];
    }
    
    async getDiscoveryByFileServerIdAndParentPath(fileServerId: string, parentPath: string) {
        const data = await this.getDataFromParentPath(fileServerId, parentPath);
        return data.map((item) => ({
            ...item,
            childs: []
        }));
    }

    getDataFromParentPath = async (fileServerId: string, parentPath: string) => {
        return await this.inventoryRepo.find({
            where: { file_server: fileServerId, parent_path: parentPath }
        });
    }

}


