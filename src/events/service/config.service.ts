import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ConfigEntity } from "src/entities/config.entity";
import { Repository } from "typeorm";
import { PathsAck } from "./service.type";
import { FileServerEntity } from "src/entities/fileserver.entity";
import { VolumeEntity } from "src/entities/volume.entity";
import { ListPathRes } from "../events.type";
import { OperationToProtocol } from "src/utils/mapper";

@Injectable()
export class FileConfigService {
    private logger : Logger = new Logger(FileConfigService.name);
    constructor(
        @InjectRepository(ConfigEntity)
        private readonly configEntity: Repository<ConfigEntity>,

        @InjectRepository(FileServerEntity)
        private readonly fileServerEntity: Repository<FileServerEntity>,

        @InjectRepository(VolumeEntity)
        private readonly volumeEntity: Repository<VolumeEntity>,
    ) {}


    // Update or add path corresponding to fileserver
    async updatePathToConfig(configId: string, ack: ListPathRes) {

        const config = await this.configEntity.findOne({
            where: {id: configId},
            relations: {
                fileServers: {
                    workers: true,
                    volumes: true
                }
            }
        }) 
        
        if(!config) {
            this.logger.error(`Config Does't exist for id ${configId}`)
            return
        }

        ack.operations.forEach(async operation => {
            const protocol =  OperationToProtocol(operation.operation)
            const fileServer = config.fileServers.find(it=>it.protocol === protocol)
            if(fileServer) {
                // Update or add to path
                const exiting = new Map<string, VolumeEntity>();
                fileServer.volumes.forEach(vol=> exiting.set(vol.volumePath, vol))
                let mxCnt = 1;
                operation.response.paths.forEach(async (path)=> {
                    if(!exiting.has(path)) {
                        const pathEntity = this.volumeEntity.create({fileServerId: fileServer.id, volumePath: path, createdBy: configId, reachableCount: 1})
                        await this.volumeEntity.save(pathEntity)
                    }else {
                        const pre:VolumeEntity = exiting.get(path)
                        this.logger.log(`Updating Path reach count for ${path}`)
                        await this.volumeEntity.update({id: pre.id},{reachableCount: pre.reachableCount+1})
                        mxCnt = Math.max(mxCnt, pre.reachableCount+1);
                    }
                })
                const isRefreshed = mxCnt === fileServer.workers.length;
                if(isRefreshed) 
                    await this.fileServerEntity.update({id: fileServer.id}, {isRefreshed: true})

            }
            else this.logger.error(`${protocol} fileServer does not exist for ${configId}`)
        })
        await this.configEntity.update({id: configId}, {refreshedOn: new Date()})
    }

    // Get config
    async getPathConfig(configId: string) {
        return await this.configEntity.findOne({where: {id: configId}, relations : {
            fileServers: {
                workers: true
            }
        }})
    }

    // Set reset worker reach count and refreshed flag
    async updateRefetchingConfig(config: ConfigEntity) {
        config.fileServers.forEach(async server=> {
            await this.volumeEntity.update({fileServerId: server.id}, {reachableCount: 0})
        })
        return this.fileServerEntity.update({configId: config.id}, {isRefreshed: false})
    }
}

