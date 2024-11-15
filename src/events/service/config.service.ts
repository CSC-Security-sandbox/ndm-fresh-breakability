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

        const fileServer = await this.fileServerEntity.findOne({where: {configId: pathAck.config.configId, protocol: pathAck.config.protocol}})
        const exiting = new Set<string>();
        fileServer.volumes.forEach(vol=> exiting.add(vol.volumePath))
        
        pathAck.path.forEach(async (path)=> {
            const pathEntity = this.volumeEntity.create({fileServerId: fileServer.id, volumePath: path.mountPath})
            await this.volumeEntity.save(pathEntity)
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
}

