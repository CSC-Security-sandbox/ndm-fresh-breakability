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


    // update or add path corresponding to fileserver
    async updatePathToConfig(payload: any) {
        const pathAck: PathsAck = payload as PathsAck
        const fileServer = await this.fileServerEntity.findOne({
            where: {configId: pathAck.config.configId, protocol: pathAck.config.protocol},
            relations: {
                workers: true,
                 volumes: true
            }
        })
        const exiting = new Map<string, VolumeEntity>();
        fileServer.volumes.forEach(vol=> exiting.set(vol.volumePath, vol))
        
        let mxCnt = 1;
        pathAck.path.forEach(async (path)=> {
            if(!exiting.has(path.mountPath)) {
                const pathEntity = this.volumeEntity.create({fileServerId: fileServer.id, volumePath: path.mountPath, createdBy: pathAck.config.configId, reachableCount: 1})
                await this.volumeEntity.save(pathEntity)
            }else {
                const pre:VolumeEntity = exiting.get(path.mountPath)
                this.logger.log(`Updating Path reach count for ${path.mountPath}`)
                await this.volumeEntity.update({id: pre.id},{reachableCount: pre.reachableCount+1})
                mxCnt = Math.max(mxCnt, pre.reachableCount+1);
            }
        })

        const isRefreshed = mxCnt === fileServer.workers.length;
        if(isRefreshed) 
            await this.fileServerEntity.update({id: fileServer.id}, {isRefreshed: true})
        
        await this.configEntity.update({id: pathAck.config.configId}, {refreshedOn: new Date()})
    }

    // get config
    async getPathConfig(configId: string) {
        return await this.configEntity.findOne({where: {id: configId}, relations : {
            fileServers: {
                workers: true
            }
        }})
    }

    // set reset worker reach count and refreshed flag
    async updateRefetchingConfig(config: ConfigEntity) {
        config.fileServers.forEach(async server=> {
            await this.volumeEntity.update({fileServerId: server.id}, {reachableCount: 0})
        })
        return this.fileServerEntity.update({configId: config.id}, {isRefreshed: false})
    }
}

