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
import { ValidateExportPathAndWorkingDirectoryDTO } from './dto/validate-export-path-working-directory.dto';
import { ListPathDTO } from 'src/work-manager/dto/validate-export-path.dto';

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
        if (!isUUID(configId)) {
            throw new BadRequestException('Invalid configId');
        }
    
        try {
            const config = await this.fetchConfigWithRelations(configId);
            const validJobConfigs = this.extractValidJobConfigs(config);
    
            if (validJobConfigs.length === 0) return [];
    
            const volumeMap = await this.getVolumeDetailsMap(validJobConfigs);
    
            return this.constructResponse(validJobConfigs, volumeMap);
        } catch (error) {
            console.error('Error fetching cutover details:', error.message);
            throw new InternalServerErrorException('An error occurred while processing the request.');
        }
    }
    
    private async fetchConfigWithRelations(configId: string) {
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
                            targetPathId: true
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
    
        if (!config) {
            throw new NotFoundException(`Config for id ${configId} not found.`);
        }
    
        return config;
    }
    
    private extractValidJobConfigs(config: ConfigEntity) {
        return config.fileServers.flatMap(fileServer =>
            fileServer.volumes.flatMap(volume =>
                volume.jobConfig
                    .filter(jobConfig =>
                        jobConfig.jobType === JobType.Migrate &&
                        jobConfig.jobRunDetails.some(jobRun => jobRun.status === JobRunStatus.Completed)
                    )
                    .map(job => ({
                        protocol: fileServer.protocol,
                        sourcePathId: job.sourcePathId,
                        targetPathId: job.targetPathId,
                        jobConfig: {
                            id: job.id,
                            jobType: job.jobType,
                            jobRunDetails: job.jobRunDetails.map(runDetail => ({
                                id: runDetail.id,
                                status: runDetail.status
                            }))
                        }
                    }))
            )
        );
    }
    
    private async getVolumeDetailsMap(validJobConfigs: any[]) {
        const volumeIds = [
            ...new Set(validJobConfigs.flatMap(job => [job.sourcePathId, job.targetPathId]))
        ].filter(Boolean);
    
        if (volumeIds.length === 0) {
            throw new NotFoundException('No valid volumes found for the given config.');
        }
    
        const volumeDetails = await this.volumes.find({
            where: { id: In(volumeIds) },
            relations: ['fileServer', 'fileServer.config'],
            select: {
                id: true,
                volumePath: true,
                fileServer: {
                    id: true,
                    config: {
                        id: true,
                        configName: true
                    }
                }
            }
        });
    
        if (!volumeDetails.length) {
            throw new NotFoundException('Volume details not found.');
        }
    
        return new Map(volumeDetails.map(volume => [
            volume.id,
            {
                id: volume.id,
                sourcePathName: volume.volumePath,
                destinationPathName: volume.volumePath,
                configId: volume.fileServer?.config?.id || '',
                configName: volume.fileServer?.config?.configName || ''
            }
        ]));
    }
    
    private constructResponse(validJobConfigs: any[], volumeMap: Map<string, any>) {
        return validJobConfigs.map(job => ({
            protocol: job.protocol,
            sourcePath: volumeMap.get(job.sourcePathId) ? {
                id: volumeMap.get(job.sourcePathId)?.id,
                sourcePathName: volumeMap.get(job.sourcePathId)?.sourcePathName
            } : { id: '', sourcePathName: '' },
    
            destinationFileServer: volumeMap.get(job.targetPathId) ? {
                id: volumeMap.get(job.targetPathId)?.configId,
                destinationFileServerName: volumeMap.get(job.targetPathId)?.configName
            } : {},
    
            destinationPath: volumeMap.get(job.targetPathId) ? {
                id: volumeMap.get(job.targetPathId)?.id,
                destinationPathName: volumeMap.get(job.targetPathId)?.destinationPathName
            } : { id: '', destinationPathName: '' },
    
            jobConfig: [job.jobConfig]
        }));
    }
    
    async createConfiguration(createConfig: ConfigDTO, userId: string, traceId: string) {
        this.logger.log("Config creation started");        
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

            const hasPathName = createConfig?.workingDirectory?.pathName?.length > 0;
            const hasWorkers = !createConfig?.fileServers?.some(fs => fs?.workers?.length > 0);

            const config = this.configEntity.create({
                configName: createConfig.configName,
                configType: createConfig.configType,
                projectId: createConfig.projectId,
                status: (hasWorkers || hasPathName) ? ConfigStatus.DRAFT : ConfigStatus.ACTIVE,
                fileServers:  await Promise.all(fileServerPromises),
                createdBy: userId,
            });
        
            const update = await this.configEntity.save(config);

            const listPathPayload: ListPathDTO[] = [];
            
            createConfig?.fileServers?.forEach((fileServer)=>{
                const payload: ListPathDTO = {
                    type: fileServer?.protocol,
                    host: fileServer?.host,
                    username: fileServer?.userName,
                    password: fileServer?.password
                }
                listPathPayload.push(payload);
            });

            const payload: ValidateExportPathAndWorkingDirectoryDTO = {
                exportPath: createConfig?.workingDirectory?.pathName,
                workingDirectory: createConfig?.workingDirectory?.workingDirectory,
                configId: update.id,
                workerIds: [],
                listPathPayload,
                options: new Options()
            }

            createConfig?.fileServers?.forEach((fileServer) => {
                fileServer?.workers?.forEach(worker => {
                    if (!payload.workerIds.includes(worker))
                        payload.workerIds.push(worker);
                })
            });

            if(payload.workerIds.length > 0 && createConfig?.workingDirectory?.pathName.length > 0) {                
                this.logger.log('starting ValidateWorkingDirectoryWorkflow');            
                const startWorkFlowPayload: StartWorkFlowPayload = {
                    workflowId: WorkFlows.VALIDATE_EXPORT_PATH_AND_WORKING_DIRECTORY + '-' + traceId,
                    taskQueue: 'ParentWorkflow-TaskQueue',
                    args: [{ traceId: traceId, payload: {traceId, ...payload}, options: payload.options }],
                    ...payload.options
                };
    
                await this.workFlowService.startWorkflow(WorkFlows.VALIDATE_EXPORT_PATH_AND_WORKING_DIRECTORY, startWorkFlowPayload);
                this.logger.log('started ValidateWorkingDirectoryWorkflow successfully');
            }
         
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