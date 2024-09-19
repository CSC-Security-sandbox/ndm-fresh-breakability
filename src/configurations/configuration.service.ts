import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AgentEntity } from 'src/entities/agent.entity';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { FindManyOptions, Repository } from 'typeorm';
import { validate as isUUID, v4 as uuidv4 } from 'uuid';
import { CreateConfigDTO } from './dto/createconfig.dto';
import { FindallConfigPageDto } from './dto/findallconfig.dto';
import { ConfigUpdateDTO } from './dto/updateconfig.dto';


@Injectable()
export class ConfigurationService {
    private logger: Logger = new Logger(ConfigurationService.name)
    constructor(
        @InjectRepository(ConfigEntity)
        private readonly configEntity: Repository<ConfigEntity>,
        @InjectRepository(FileServerEntity)
        private readonly fileServerEntity: Repository<FileServerEntity>,
        @InjectRepository(VolumeEntity)
        private readonly volumeEntity: Repository<VolumeEntity>,
        @InjectRepository(AgentEntity)
        private readonly agentEntity: Repository<AgentEntity>,
    ) {}

    async getAllConfig(findallConfigPageDto: FindallConfigPageDto) {
        const { page, limit, sort = 'createdAt', order = 'ASC', ...filter } = findallConfigPageDto;
        
        const findOptions: FindManyOptions<ConfigEntity> = {
          where: filter, order: { [sort]: order }, 
          relations: {
            project: true,
            fileServers: {
                agents: true,
                volumes: true
            }
          }
        };
        let data = [], total = 0;
        if (page && limit) {
          findOptions.skip = (parseInt(page) - 1) * parseInt(limit); 
          findOptions.take = parseInt(limit); 
          data = await this.configEntity.find(findOptions);
          total = await this.configEntity.count({ where: filter });
        } else {
          data = await this.configEntity.find(findOptions);
          total = await this.configEntity.count();
        }
        return { data, total };
    }

    async getConfigById(id: string) {
        if(!isUUID(id)) 
            throw new BadRequestException('Invalid configId')
        const config =  await this.configEntity.findOne({
            where: { id },
            relations: {
                project: true,
                fileServers: {
                    agents: true,
                    volumes: true
                }
            }
        });
        if(!config) throw new NotFoundException(`Config for id ${id} not found.`)
        return config
    }

    async createConfiguration(createConfig: CreateConfigDTO) {
        const userId = uuidv4();
    
        const fileServerPromises = createConfig.fileServers.map(async (fileServer) => {
            const agents = await this.agentEntity.findByIds(fileServer.agents);

            const volumes = fileServer.volumes.map(volume => 
                this.volumeEntity.create({
                    volumePath: volume.volumePath,
                    isIncluded: volume.isIncluded,
                    createdBy: userId
                })
            );
    
            return this.fileServerEntity.create({
                host: fileServer.host,
                serverType: fileServer.serverType,
                agents: agents,
                createdBy: userId,
                protocal: fileServer.protocol,  
                userName: fileServer.userName,
                volumes: volumes
            });
        });

        const config = this.configEntity.create({
            configName: createConfig.configName,
            configType: createConfig.configType,
            projectId: createConfig.projectId,
            stage: createConfig.stage,
            fileServers:  await Promise.all(fileServerPromises),
            createdBy: userId
        });
    
        return await this.configEntity.save(config);
    }

    async updateConfiguration(id: string, updateConfig: ConfigUpdateDTO) {
        if(!isUUID(id)) 
            throw new BadRequestException('Invalid configId')

        const userId = uuidv4();
        const config = await this.configEntity.findOne({
            where: { id },
            relations: {
                fileServers: {
                    agents: true,
                    volumes: true
                }
            }
        });
    
        if (!config) {
            throw new NotFoundException(`Config for id ${id} not found.`);
        }

        config.configName = updateConfig.configName;
        config.configType = updateConfig.configType;
        config.createdBy = updateConfig.createdBy || userId
        config.stage = updateConfig.stage
        config.updatedBy = userId
    
        const fileServerPromises = updateConfig.fileServers.map(async (fileServer) => {
            const agents = await this.agentEntity.findByIds(fileServer.agents);

            const volumes = fileServer.volumes.map(volume => 
                this.volumeEntity.create({
                    id: volume.id,
                    volumePath: volume.volumePath,
                    isIncluded: volume.isIncluded,
                    createdBy: volume.createdBy || userId,
                    updatedBy: userId
                })
            );
    
            return this.fileServerEntity.create({
                id: fileServer.id,
                host: fileServer.host,
                serverType: fileServer.serverType,
                agents: agents,
                createdBy: fileServer.createdBy || userId,
                protocal: fileServer.protocol,  
                userName: fileServer.userName,
                volumes: volumes,
                updatedBy: userId
            });
        });
        config.fileServers = await Promise.all(fileServerPromises);
        return await this.configEntity.save(config);
    }
    

    async remove(id: string) {
        if(!isUUID(id)) 
            throw new BadRequestException('Invalid configId')
        const config = await this.configEntity.findOne({
                where: { id }
            });
        return await this.configEntity.remove(config)
    }
}