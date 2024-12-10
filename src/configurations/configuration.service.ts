import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { RabbitMQService } from 'src/rabbitmq/rabbitmq.service';
import { FindManyOptions, In, Repository } from 'typeorm';
import { validate as isUUID, v4 as uuidv4 } from 'uuid';
import { Credentials } from './configuration.types';
import { ConfigDTO } from './dto/config.dto';
import { FindallConfigPageDto } from './dto/findallconfig.dto';
import { RabbitMq } from 'src/constants/enums';


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
        private rabbitMQService: RabbitMQService
        
    ) {}

    async getAllConfig(findallConfigPageDto: FindallConfigPageDto) {
        const { page, limit, sort = 'createdAt', order = 'ASC', ...filter } = findallConfigPageDto;
        
        const findOptions: FindManyOptions<ConfigEntity> = {
          where: filter, order: { [sort]: order }, 
          select: {
            id: true,
            configName: true,
            configType: true,
            projectId: true,
            createdAt: true,
            createdBy: true,
            fileServers:{
                id: true,
                host: true,
                serverType: true,
                protocol: true,
                userName: true,
                isRefreshed: true,
                createdAt: true,
                createdBy: true,
            }
          },
          relations: {
            fileServers: true
          },
        };
        let serverConfig = [], total = 0;
        if (page && limit) {
            findOptions.skip = (parseInt(page) - 1) * parseInt(limit); 
            findOptions.take = parseInt(limit); 
            serverConfig = await this.configEntity.find(findOptions);
            total = await this.configEntity.count({ where: filter });
        } else {
            serverConfig = await this.configEntity.find(findOptions);
            total = await this.configEntity.count();
        }
        return { serverConfig, total };
    }

    async getConfigById(id: string) {
        if(!isUUID(id)) 
            throw new BadRequestException('Invalid configId')
        const config =  await this.configEntity.findOne({
            select: {
                id: true,
                configName: true,
                configType: true,
                projectId: true,
                fileServers:{
                    id: true,
                    host: true,
                    serverType: true,
                    protocol: true,
                    userName: true,
                    isRefreshed: true,
                    volumes:{
                        id: true,
                        volumePath: true,
                        jobConfig: {
                            id: true,
                            jobType: true,
                            jobRunDetails: {
                                id: true,
                                status: true
                            }
                        }
                    }
                }
            },
            where: { id },
            relations: {
                project: true,
                fileServers: {
                    workers: true,
                    volumes: {
                        jobConfig: {
                              jobRunDetails: true  
                        }    
                    }
                        
                }
            }
        });

        
        if(!config) throw new NotFoundException(`Config for id ${id} not found.`)
        return config
    }

    async createConfiguration(createConfig: ConfigDTO) {
        const userId = uuidv4();
        const credentials:Credentials[] = []
        try {
            const fileServerPromises = createConfig.fileServers.map(async (fileServer) => {
                const workers = await this.WorkerEntity.find({where: {workerId: In(fileServer.workers)}});
                credentials.push({
                    details: {
                        hostname: fileServer.host,
                        username: fileServer.userName,
                        password: fileServer?.password
                    },
                    protocol: fileServer.protocol,
                    workers: workers.map(it=>it.workerId)
                })
                return this.fileServerEntity.create({
                    host: fileServer.host,
                    serverType: fileServer.serverType,
                    workers: workers,
                    createdBy: userId,
                    protocol: fileServer.protocol,  
                    userName: fileServer.userName,
                    password: fileServer?.password,
                    isRefreshed: false,
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
        
            const update = await this.configEntity.save(config)
            await this.rabbitMQService.sendMessage(RabbitMq.ListPaths,  {configId: update.id, credentials})
            return update
        }catch(error) {
            this.logger.error(`Error Occurred during creating Config ${error}`)
            throw new InternalServerErrorException('Error Occurred during creating Config')
        }
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

        const credentials:Credentials[] = []

        config.configName = updateConfig.configName;
        config.configType = updateConfig.configType;
        config.createdBy = updateConfig.createdBy || userId
        config.updatedBy = userId

        try {
            const fileServerPromises = config.fileServers.map(async (fileServer)=> {
                const workers = await this.WorkerEntity.find({where: {workerId : In(fileServer.workers)}});

                const update = updateConfig.fileServers.find(it=> it.protocol == fileServer.protocol && it.host == fileServer.host)

                credentials.push({
                    details: {
                        hostname: update.host,
                        username: update.userName,
                        password: update?.password
                    },
                    protocol: fileServer.protocol,
                    workers: workers.map(it=>it.workerId)
                })
                
                return this.fileServerEntity.create({
                    id: fileServer.id,
                    host: fileServer.host,
                    serverType: fileServer.serverType,
                    workers: workers,
                    createdBy: fileServer.createdBy,
                    protocol: fileServer.protocol,  
                    userName: update.userName || fileServer.userName,
                    volumes: fileServer.volumes,
                    password: update.password,
                    updatedBy: userId,
                    isRefreshed: false
                });
            })

            config.fileServers = await Promise.all(fileServerPromises);
            const update = await this.configEntity.save(config)
            await this.rabbitMQService.sendMessage(RabbitMq.ListPaths,  {configId: config.id})
            return update
        }catch(error) {
            this.logger.error(`Error Occurred during updating Config ${error}`)
            throw new InternalServerErrorException('Error Occurred during updating Config')
        }
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