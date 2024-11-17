import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ConfigEntity } from "src/entities/config.entity";
import { Repository } from "typeorm";
import { PathsAck } from "./service.type";
import { FileServerEntity } from "src/entities/fileserver.entity";
import { VolumeEntity } from "src/entities/volume.entity";




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


    async updatePathToConfig(payload: any) {
        const pathAck: PathsAck = payload as PathsAck
        const fileServer = await this.fileServerEntity.findOne({where: {configId: pathAck.config.configId,}})

        const exiting = new Map<string, VolumeEntity>();
        fileServer.volumes.forEach(vol=> exiting.set(vol.volumePath, vol))
        
        pathAck.path.forEach(async (path)=> {
            if(!exiting.has(path.mountPath)) {
                const pathEntity = this.volumeEntity.create({fileServerId: fileServer.id, volumePath: path.mountPath, createdBy: pathAck.config.configId, reachableCount: 1})
                await this.volumeEntity.save(pathEntity)
            }else {
                const pre:VolumeEntity = exiting.get(path.mountPath)
                this.logger.log(`Updating Path reach count for ${path.mountPath}`)
                await this.volumeEntity.update({id: pre.id},{reachableCount: pre.reachableCount+1})
            }
        })

        await this.configEntity.update({id: pathAck.config.configId}, {refreshedOn: new Date()})
    }

    async getPathConfig(configId: string) {
        return await this.configEntity.findOne({where: {id: configId}, relations : {
            fileServers: {
                workers: true
            }
        }})
    }

    async resetReachableWorkerCount(fileServerId: string) {
        this.logger.log(fileServerId)
        return await this.volumeEntity.update({fileServerId: fileServerId}, {reachableCount: 0})
    }
}

