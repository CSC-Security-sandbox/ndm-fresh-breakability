import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { FindManyOptions, In, Repository } from 'typeorm';
import { validate as isUUID, v4 as uuidv4 } from 'uuid';
import { ConfigDTO } from './dto/config.dto';
import { FindallConfigPageDto } from './dto/findallconfig.dto';


@Injectable()
export class ConfigurationService {
    private logger: Logger = new Logger(ConfigurationService.name)
    constructor(
        @InjectRepository(ConfigEntity)
        private readonly configEntity: Repository<ConfigEntity>,
        @InjectRepository(FileServerEntity)
        private readonly fileServerEntity: Repository<FileServerEntity>,
        @InjectRepository(WorkerEntity)
        private readonly WorkerEntity: Repository<WorkerEntity>,
    ) {}

    async getAllConfig(findallConfigPageDto: FindallConfigPageDto) {
        const { page, limit, sort = 'createdAt', order = 'ASC', ...filter } = findallConfigPageDto;
        
        const findOptions: FindManyOptions<ConfigEntity> = {
          where: filter, order: { [sort]: order }, 
          relations: {
            fileServers: true
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
                    workers: true,
                    volumes: true
                }
            }
        });
        if(!config) throw new NotFoundException(`Config for id ${id} not found.`)
        return config
    }

    async createConfiguration(createConfig: ConfigDTO) {
        const userId = uuidv4();
    
        const fileServerPromises = createConfig.fileServers.map(async (fileServer) => {
            const workers = await this.WorkerEntity.find({where: {workerId: In(fileServer.workers)}});

            return this.fileServerEntity.create({
                host: fileServer.host,
                serverType: fileServer.serverType,
                workers: workers,
                createdBy: userId,
                protocol: fileServer.protocol,  
                userName: fileServer.userName,
                volumes: []
            });
        });

        const config = this.configEntity.create({
            configName: createConfig.configName,
            configType: createConfig.configType,
            projectId: createConfig.projectId,
            fileServers:  await Promise.all(fileServerPromises),
            createdBy: userId
        });
    
        return await this.configEntity.save(config);
    }

    async updateConfiguration(id: string, updateConfig: ConfigDTO) {
        if(!isUUID(id)) 
            throw new BadRequestException('Invalid configId')

        const userId = uuidv4();
        const config = await this.configEntity.findOne({
            where: { id },
            relations: {
                fileServers: {
                    workers: true,
                    volumes: true
                }
            }
        });
    
        if (!config) 
            throw new NotFoundException(`Config for id ${id} not found.`);

        config.configName = updateConfig.configName;
        config.configType = updateConfig.configType;
        config.createdBy = updateConfig.createdBy || userId
        config.updatedBy = userId

        const fileServerPromises = config.fileServers.map(async (fileServer)=> {
            const workers = await this.WorkerEntity.find({where: {workerId : In(fileServer.workers)}});

            const update = updateConfig.fileServers.find(it=> it.protocol == fileServer.protocol && it.host == fileServer.host)
            
            return this.fileServerEntity.create({
                id: fileServer.id,
                host: fileServer.host,
                serverType: fileServer.serverType,
                workers: workers,
                createdBy: fileServer.createdBy,
                protocol: fileServer.protocol,  
                userName: update.userName || update.userName,
                volumes: fileServer.volumes,
                updatedBy: userId
            });
        })

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