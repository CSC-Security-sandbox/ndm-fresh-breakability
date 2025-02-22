import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { ConfigStatus, WorkFlows } from 'src/constants/enums';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { FileServerWorkingDirectoryMappingEntity } from 'src/entities/fileserver_workingdirectory_mapping.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { CreateRequestDto, Options } from 'src/work-manager/dto/validate-connection.dto';
import { WorkflowService } from 'src/workflow/workflow.service';
import { StartWorkFlowPayload, WorkflowExecutionStatus } from 'src/workflow/workflow.types';
import { FindManyOptions, In, Repository } from 'typeorm';
import { validate as isUUID } from 'uuid';
import { Credentials, ListPathWorkflowStatus, PathsMap } from './configuration.types';
import { ConfigDTO } from './dto/config.dto';
import { FindAllConfigPageDto } from './dto/findallconfig.dto';
import { JobType } from 'src/entities/jobconfig.entity';
import { JobRunStatus } from 'src/entities/jobrun.entity';

@Injectable()
export class ConfigurationService {
    private logger : LoggerService
    constructor(
        @InjectRepository(ConfigEntity)
        private readonly configEntity: Repository<ConfigEntity>,
        @InjectRepository(FileServerEntity)
        private readonly fileServerEntity: Repository<FileServerEntity>,
        @InjectRepository(VolumeEntity)
        private readonly volumes: Repository<VolumeEntity>,
        @InjectRepository(FileServerWorkingDirectoryMappingEntity)
        private readonly fileServerWorkingDirectoryMappingEntity: Repository<FileServerWorkingDirectoryMappingEntity>,
        @InjectRepository(WorkerEntity)
        private readonly WorkerEntity: Repository<WorkerEntity>,
        private loggerFactory: LoggerFactory,
        private readonly workFlowService: WorkflowService
    ) {
        this.logger = this.loggerFactory.create(ConfigurationService.name)
    }

    async getAllConfig(findAllConfigPageDto: FindAllConfigPageDto) {
        const { page, limit, sort = 'createdAt', order = 'ASC', ...filter } = findAllConfigPageDto;
        
        const findOptions: FindManyOptions<ConfigEntity> = {
          where: filter, order: { [sort]: order }, 
          select: {
            id: true,
            configName: true,
            configType: true,
            projectId: true,
            createdAt: true,
            createdBy: true,
            scannedDate: true,
            status: true,
            fileServers:{
                id: true,
                host: true,
                serverType: true,
                protocol: true,
                userName: true,
                isRefreshed: true,
                createdAt: true,
                createdBy: true,
                protocolVersion: true
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
                scannedDate: true,
                status: true,
                workingDirectory: {
                    pathName: true,
                    workingDirectory: true,
                    pathId: true
                },
                fileServers:{
                    id: true,
                    host: true,
                    serverType: true,
                    protocol: true,
                    userName: true,
                    password: true,
                    isRefreshed: true,
                    protocolVersion: true,
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
                        
                },
                workingDirectory: true 
            }
        });
     
        if(!config) throw new NotFoundException(`Config for id ${id} not found.`)
        return config
    }

    async getCutoverDetailsByConfigId(configId: string) {
        if (!isUUID(configId))
            throw new BadRequestException('Invalid configId')
        const config = await this.configEntity.findOne({
            select: {
                id: true,
                configName: true,
                configType: true,
                fileServers: {
                    id: true,
                    host: true,
                    serverType: true,
                    protocol: true,
                    volumes: {
                        id: true,
                        volumePath: true,
                        jobConfig: {
                            id: true,
                            jobType: true,
                            sourcePathId: true,
                            targetPathId: true,
                            jobRunDetails: {
                                id: true,
                                status: true
                            }
                        }
                    }
                }
            },
            where: { id: configId },
            relations: {
                fileServers: {
                    volumes: {
                        jobConfig: {
                            jobRunDetails: true
                        }
                    }

                }
            }
        });

        if (!config) throw new NotFoundException(`Config for id ${configId} not found.`);

        const response = [];

        for (const fileServer of config.fileServers) {
            for (const volume of fileServer.volumes) {
                const validJobConfigs = volume.jobConfig
                    .filter(jobConfig =>
                        jobConfig.jobType === JobType.Migrate &&
                        jobConfig.jobRunDetails.some(jobRun => jobRun.status === JobRunStatus.Completed)
                    )

                if (validJobConfigs.length > 0) {
                    response.push({
                        protocol: fileServer.protocol,
                        sourcePath: {},
                        destinationFileServer: {},
                        destinationPath: {},
                        jobConfig: validJobConfigs,
                    });
                }
            }
        }

        for (const obj of response) {
            for (const jobConfig of obj.jobConfig) {
                const sourceData = await this.volumeDetails(jobConfig.sourcePathId, 'source');
                const targetData = await this.volumeDetails(jobConfig.targetPathId, 'target');
                obj.sourcePath = { id: sourceData.id, sourcePathName: sourceData.volumePath };
                obj.destinationPath = { id: targetData.id, destinationPathName: targetData.volumePath };
                obj.destinationFileServer = { id: targetData.configId, destinationFileServerName: targetData.configName };
                obj.jobConfig = obj.jobConfig.map(config => ({
                    id: config.id,
                    jobType: config.jobType,
                    jobRunDetails: config.jobRunDetails
                }));
            }
        }

        return response;
    }

    async volumeDetails(volumeId: string, fileServer: string): Promise<{
        id: string;
        volumePath: string;
        configId?: string;
        configName?: string;
    }> {
        if (fileServer === 'source') {
            const volume = await this.volumes.findOne({ where: { id: volumeId }, select: ['id', 'volumePath'] });
            return {
                id: volume?.id || '',
                volumePath: volume?.volumePath || ''
            };
        }

        const volumeWithConfig = await this.volumes.findOne({
            where: { id: volumeId },
            relations: ['fileServer', 'fileServer.config'],
            select: {
                id: true,
                volumePath: true,
                fileServer: {
                    id: true,
                    config: {
                        id: true,
                        configName: true,
                    }
                }
            }
        });

        return {
            id: volumeWithConfig?.id || '',
            volumePath: volumeWithConfig?.volumePath || '',
            configId: volumeWithConfig?.fileServer?.config?.id,
            configName: volumeWithConfig?.fileServer?.config?.configName
        };
    }

    async createConfiguration(createConfig: ConfigDTO, userId: string, traceId: string) {
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
                    protocolVersion:fileServer.protocolVersion,
                    userName: fileServer.userName,
                    password: fileServer?.password,
                    isRefreshed: false,
                    volumes: [],
                });
            });

            const config = this.configEntity.create({
                configName: createConfig.configName,
                configType: createConfig.configType,
                projectId: createConfig.projectId,
                status: createConfig?.workingDirectory?.pathName.length > 0 ? ConfigStatus.DRAFT : ConfigStatus.ACTIVE,
                fileServers:  await Promise.all(fileServerPromises),
                createdBy: userId,
            });
        
            const update = await this.configEntity.save(config);
         
            const workingDirectory = this.fileServerWorkingDirectoryMappingEntity.create({
                pathName: createConfig?.workingDirectory?.pathName,
                pathId: createConfig?.workingDirectory?.pathId,
                workingDirectory: createConfig?.workingDirectory?.workingDirectory,
                configId: update.id,
                createdBy: userId
            });
            await this.fileServerWorkingDirectoryMappingEntity.save(workingDirectory);
            this.refreshConfig(update.id, traceId)
            return update;
        }catch(error) {
            this.logger.error(`Error Occurred during creating Config ${error} for request ${traceId}`)
            throw new InternalServerErrorException('Error Occurred during creating Config')
        }
    }

    async updateConfiguration(id: string, updateConfig: ConfigDTO, userId: string, traceId: string) {
        if(!isUUID(id)) 
            throw new BadRequestException('Invalid configId')

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
                const update = updateConfig.fileServers.find(it=> it.protocol == fileServer.protocol && it.host == fileServer.host)
                const workers = await this.WorkerEntity.find({where: {workerId : In(update?.workers)}});

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
                    protocolVersion:update?.protocolVersion,
                    userName: update.userName || fileServer.userName,
                    volumes: fileServer.volumes,
                    password: update.password,
                    updatedBy: userId,
                    isRefreshed: false
                });
            });

            const { workingDirectory } = updateConfig;

            const mapping = await this.fileServerWorkingDirectoryMappingEntity.findOne({ where: {configId: id} });

            if (!mapping) {
                this.logger.error(`Mapping for configId ${id} not found for request ${traceId}`);
                throw new NotFoundException(`Mapping for configId ${id} not found`);
            }

            Object.assign(mapping, {
                pathName: workingDirectory?.pathName ?? mapping?.pathName,
                workingDirectory: workingDirectory?.workingDirectory ?? mapping?.workingDirectory,
                pathId: workingDirectory?.pathId ?? mapping?.pathId,
            });

            await this.fileServerWorkingDirectoryMappingEntity.save(mapping);

            config.fileServers = await Promise.all(fileServerPromises);
            const update = await this.configEntity.save(config)
            this.refreshConfig(update.id, traceId)
            return update
        }catch(error) {
            this.logger.error(`Error Occurred during updating Config ${error} for traceId ${traceId}`)
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

    async refreshConfig(id: string, traceId: string) {
        const config = await this.configEntity.findOne({where : {id}, relations: {fileServers : {workers: true}, }})
        if(!config)
            throw new NotFoundException(`Config Not found with config id ${id}`)

        const payload :CreateRequestDto = {
            fileServer: {
                hostname: '',
                protocols: []
            },
            options: new Options(),
            workerIds: []
        }
        config.fileServers?.forEach((fileServer)=>{
            payload.fileServer.hostname = fileServer.host
            payload.fileServer.protocols.push({
                type: fileServer.protocol,
                username: fileServer.userName,
                password: fileServer.password
            })
            fileServer?.workers?.forEach(worker=>{
                if(!payload.workerIds.includes(worker.workerId))
                    payload.workerIds.push(worker.workerId)
            })
        })
        if(payload.workerIds.length === 0) return
        await this.fileServerEntity.update({id: In(config.fileServers.map(it=>it.id))}, {isRefreshed: false})
        const startWorkFlowPayload: StartWorkFlowPayload = {
            workflowId: WorkFlows.LIST_PATHS + '-' + traceId,
            taskQueue: 'ParentWorkflow-TaskQueue',
            args: [{ traceId: traceId, payload: {traceId, ...payload}, options: payload.options }],
            ...payload.options
        }
        const workflow = await this.workFlowService.startWorkflow(WorkFlows.LIST_PATHS, startWorkFlowPayload)
        this.updateResult( workflow.workflowId, id)
        return {workflowId : workflow.workflowId}
    }

    async updateResult(id: string, configId: string) {
        setTimeout(async ()=>{
            const details: ListPathWorkflowStatus = await this.workFlowService.getWorkFlowRes(id) as ListPathWorkflowStatus
            if(details.status === WorkflowExecutionStatus.COMPLETED)
                await this.updatePaths(configId, details)
        },2000)
    }

    async updatePaths(id: string, details:ListPathWorkflowStatus) {
        const pathsMap: PathsMap = {
            NFS: {workers: 0, paths: []},
            SMB: {workers: 0, paths: []},
        }
        details.completed.forEach(workflow => {
            pathsMap[workflow.protocolType].workers++
            workflow.paths.forEach(path =>{
                if(!pathsMap[workflow.protocolType].paths.includes(path)) 
                pathsMap[workflow.protocolType].paths.push(path)
            });
        })
        const config =  await this.configEntity.findOne({
            select: {
                fileServers:{
                    id: true,
                    protocol: true,
                    volumes:{
                        id: true,
                        volumePath: true,
                    }
                }
            },
            where: { id },
            relations: {
                fileServers: {
                    volumes: true       
                }
            }
        });
        for(let fileServer of config.fileServers) {
            await this.volumes.update({
                fileServerId: fileServer.id,
                volumePath: In(pathsMap[fileServer.protocol].paths)
            },{ reachableCount: pathsMap[fileServer.protocol].workers})

            const existingPaths = new Set(fileServer.volumes.map(vol => vol.volumePath));
            const founds: VolumeEntity[] = []
            pathsMap[fileServer.protocol].paths.forEach((path)=>{
                if(!existingPaths.has(path))
                    founds.push(this.volumes.create({
                        fileServerId: fileServer.id,
                        reachableCount:  pathsMap[fileServer.protocol].workers,
                        volumePath: path,
                        createdBy: config.updatedBy ?? config.createdBy
                    }))
            })
            await this.volumes.save(founds)
            await this.fileServerEntity.update({id: fileServer.id},{isRefreshed: true})
        }

        await this.configEntity.update({id}, {scannedDate : new Date()})
    }
}