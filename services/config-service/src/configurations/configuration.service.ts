import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { FindManyOptions, In, Repository } from 'typeorm';
import { validate as isUUID } from 'uuid';
import {
  ConfigErrorMsg,
  ConfigStatus,
  Protocol,
  ProtocolVersionError,
  ServerType,
  WorkerStatus,
  WorkFlows,
} from 'src/constants/enums';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { FileServerWorkingDirectoryMappingEntity } from 'src/entities/fileserver_workingdirectory_mapping.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import {
  JobConfigEntity,
  JobStatus,
  JobType,
} from 'src/entities/jobconfig.entity';
import { JobRunEntity, JobRunStatus } from 'src/entities/jobrun.entity';
import { WorkflowService } from 'src/workflow/workflow.service';
import { ConfigDTO, FetchCertificateRequestDTO, FetchCertificateResponseDTO, FetchZonesRequestDTO, FetchZonesResponseDTO } from './dto/config.dto';
import { ValidateExportPathAndWorkingDirectoryDTO } from './dto/validate-export-path-working-directory.dto';
import { FindAllConfigPageDto } from './dto/findallconfig.dto';
import {
  CreateRequestDto,
  Options,
} from 'src/work-manager/dto/validate-connection.dto';
import { ListPathDTO } from 'src/work-manager/dto/validate-export-path.dto';
import {
  StartWorkFlowPayload,
  WorkflowExecutionStatus,
} from 'src/workflow/workflow.types';
import {
  Credentials,
  ListPathWorkflowStatus,
  PathsMap,
} from './configuration.types';
import { ProjectEntity } from 'src/entities/project.entity';
import { SendMailService } from 'src/util/send-email';
import { ConfigService } from '@nestjs/config';
import { isWorkerHealthy } from 'src/utils/transformers';
import sanitizeHtml from 'sanitize-html';
import escapeHtml from 'escape-html';

import { PathUploadsEntity } from 'src/entities/pathupload.entity';
import { SuccessEmailType } from 'src/util/send-email.type';
import { IsilonStorageClient } from 'src/storage-clients/isilon/isilon-storage-client';

@Injectable()
export class ConfigurationService {
  private logger: LoggerService;
  private timeout: number;
  private escapeHtml: typeof escapeHtml;
  private sanitizeHtml: typeof sanitizeHtml;
  constructor(
    private readonly isilonStorageClient: IsilonStorageClient,
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
    @InjectRepository(ProjectEntity)
    private readonly projectEntity: Repository<ProjectEntity>,
    private loggerFactory: LoggerFactory,
    private readonly workFlowService: WorkflowService,
    private readonly sendMailService: SendMailService,
    private readonly configService: ConfigService,

    @InjectRepository(JobConfigEntity)
    private readonly jobConfigRepo: Repository<JobConfigEntity>,

    @InjectRepository(JobRunEntity)
    private readonly jobRunRepo: Repository<JobRunEntity>,

    @InjectRepository(PathUploadsEntity)
    private readonly pathUploadsRepo: Repository<PathUploadsEntity>,
  ) {
    this.logger = this.loggerFactory.create(ConfigurationService.name);
    this.timeout = this.configService.get<number>(
      'app.worker.healthCheckStatusTimout',
    );
    this.sanitizeHtml = sanitizeHtml;
    this.escapeHtml = escapeHtml;
  }

  async getAllFileServers(): Promise<any[]> {
    try {
      const fileServers = await this.fileServerEntity
        .createQueryBuilder('fileServer')
        .leftJoinAndSelect('fileServer.workers', 'worker')
        .leftJoinAndSelect('fileServer.config', 'config')
        .leftJoinAndSelect('config.workingDirectory', 'workingDirectory')
        .select([
          'fileServer.id',
          'fileServer.protocol',
          'worker.workerId',
          'worker.workerName',
          'config.id',
          'config.configName',
          'config.serverType',
          'config.status',
          'workingDirectory.workingDirectory',
          'fileServer.exportPathSource',
        ])
        .getMany();

      const groupedByConfig = fileServers.reduce((acc, fileServer) => {
        const configId = fileServer.config.id;
        if (!acc[configId]) {
          acc[configId] = {
            id: configId,
            serverName: fileServer.config.configName,
            hasScratchPath:
              fileServer.config.workingDirectory &&
              fileServer.config.workingDirectory.workingDirectory !== ''
                ? true
                : false,
            status: fileServer.config.status,
            serverType: fileServer.config.serverType,
            fileServers: [],
          };
        }
        acc[configId].fileServers.push({
          id: fileServer.id,
          protocol: fileServer.protocol,
          workers: fileServer.workers
            ? fileServer.workers.map((worker) => ({
                id: worker.workerId,
                workerName: worker.workerName,
              }))
            : [],
        });
        return acc;
      }, {});

      return Object.values(groupedByConfig);
    } catch (error) {
      this.logger.error(`Error fetching all file servers: ${error.message}`);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to fetch all file servers: ${error.message}`,
      );
    }
  }

  async getAllConfig(findAllConfigPageDto: FindAllConfigPageDto) {
    try {
      const {
        page,
        limit,
        sort = 'createdAt',
        order = 'ASC',
        ...filter
      } = findAllConfigPageDto;

      const findOptions: FindManyOptions<ConfigEntity> = {
        where: filter,
        order: { [sort]: order },
        select: {
          id: true,
          configName: true,
          configType: true,
          projectId: true,
          createdAt: true,
          createdBy: true,
          scannedDate: true,
          status: true,
          errorMessage: true,
          serverType: true,
          fileServers: {
            id: true,
            host: true,
            protocol: true,
            userName: true,
            isRefreshed: true,
            createdAt: true,
            createdBy: true,
            protocolVersion: true,
            exportPathSource: true,
            fileServerName: true,
            zone_id: true,
          },
        },
        relations: {
          fileServers: true,
        },
      };
      let serverConfig = [],
        total = 0;
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
    } catch (error) {
      this.logger.error(`Error fetching configurations: ${error.message}`);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to fetch configurations ${error.message}`,
      );
    }
  }

  async getConfigById(id: string) {
    try {
      if (!isUUID(id)) throw new BadRequestException('Invalid configId');

      const config = await this.configEntity.findOne({
        select: {
          id: true,
          configName: true,
          configType: true,
          projectId: true,
          scannedDate: true,
          status: true,
          errorMessage: true,
          workingDirectory: {
            pathName: true,
            workingDirectory: true,
            pathId: true,
          },
          fileServers: {
            id: true,
            host: true,
            protocol: true,
            userName: true,
            password: true,
            isRefreshed: true,
            protocolVersion: true,
            exportPathSource: true,
            fileServerName: true,
            zone_id: true,
            workers: {
              workerId: true,
              workerName: true,
              ipAddress: true,
              stats: {
                updatedAt: true,
              },
            },
            volumes: {
              id: true,
              volumePath: true,
              isValid: true,
              isDisabled: true,
              reachableCount: true,
              jobConfig: {
                id: true,
                jobType: true,
                jobRunDetails: {
                  id: true,
                  status: true,
                },
              },
            },
          },
        },
        where: { id },
        relations: {
          project: true,
          fileServers: {
            workers: {
              stats: true,
            },
            volumes: {
              jobConfig: {
                jobRunDetails: true,
              },
            },
          },
          workingDirectory: true,
        },
      });

      const uploads = await this.pathUploadsRepo.find({
        where: {
          fileServerId: In(config.fileServers.map((fs) => fs.id)),
          id: In(
            config.fileServers.flatMap((fs) => fs.volumes.map((v) => v.id)),
          ),
        },
      });

      if (!config)
        throw new NotFoundException(`Config for id ${id} not found.`);

      if (config?.fileServers) {
        config.fileServers = config.fileServers.map((fileServer) => ({
          ...fileServer,
          volumes: fileServer.volumes.map((volume) => ({
            ...volume,
            validationResult:
              uploads.find((upload) => upload.id === volume.id)
                ?.validationResponse || '',
          })),
          workers: fileServer.workers.map((worker) => ({
            ...worker,
            status: isWorkerHealthy(worker.stats.updatedAt, this.timeout)
              ? WorkerStatus.Online
              : WorkerStatus.Offline,
          })),
        }));
      }

      if ([ConfigStatus.ERRORED, ConfigStatus.DRAFT].includes(config.status)) {
        if (config.fileServers) {
          config.fileServers = config.fileServers.map((server) => ({
            ...server,
            volumes: [],
          }));
        }
      }
      // Mask sensitive information
      if (config?.fileServers) {
        config.fileServers = config.fileServers.map((fileServer) => ({
          ...fileServer,
          password: '',
        }));
      }
      const isUploadInProgress = await this.isUploadInProgress(
        config.fileServers.map((fs) => fs.id),
      );
      const refreshStatus = await this.isRefreshPossible(config.id);
      const isRefreshAvailable = !isUploadInProgress && refreshStatus.isRefreshAvailable;

      return { ...config, isRefreshAvailable, isUploadInProgress };
    } catch (error) {
      this.logger.error(`Error fetching config by ID: ${error.message}`);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to retrieve configuration for ID: ${id} Error: ${error.message}`,
      );
    }
  }

  async getCutoverDetailsByConfigId(configId: string) {
    try {
      if (!isUUID(configId)) {
        throw new BadRequestException('Invalid configId');
      }
      const config = await this.fetchConfigWithRelations(configId);
      const validJobConfigs = this.extractValidJobConfigs(config);
      if (validJobConfigs.length === 0) return [];

      const volumeMap = await this.getVolumeDetailsMap(validJobConfigs);
      return this.constructResponse(validJobConfigs, volumeMap);
    } catch (error) {
      this.logger.error(`Error fetching cutover details: ${error.message}`);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `An error occurred while processing the request.Error : ${error.message}`,
      );
    }
  }

  async isConfigNameUnique(
    projectId: string,
    configName: string,
  ): Promise<{ isUnique: boolean }> {
    try {
      const projectExists = await this.projectEntity.findOne({
        where: { id: projectId },
      });
      if (!projectExists) {
        throw new NotFoundException('Invalid Project ID');
      }

      // Sanitize configName input
      const sanitizedConfigName = await this.sanitizeConfigName(configName);

      const existingConfig = await this.configEntity.findOne({
        where: { projectId, configName: sanitizedConfigName },
      });

      if (existingConfig) {
        throw new BadRequestException(
          'Config name already exists for this project.',
        );
      }

      return { isUnique: true };
    } catch (e) {
      this.logger.error(`Error checking config name uniqueness: ${e.message}`);
      if (e instanceof NotFoundException || e instanceof BadRequestException) {
        throw e;
      }
      throw new InternalServerErrorException(
        `Failed to check config name uniqueness.${e.message}`,
      );
    }
  }

  private async sanitizeConfigName(configName: string) {
    return this.sanitizeHtml(configName, {
      allowedTags: [],
      allowedAttributes: {},
    }).trim();
  }

  private async fetchConfigWithRelations(configId: string) {
    try {
      const config = await this.configEntity.findOne({
        select: {
          id: true,
          configName: true,
          configType: true,
          fileServers: {
            id: true,
            host: true,
            protocol: true,
            exportPathSource: true,
            volumes: {
              id: true,
              volumePath: true,
              isValid: true,
              isDisabled: true,
              jobConfig: {
                id: true,
                jobType: true,
                status: true,
              },
            },
          },
        },
        where: {
          id: configId,
          fileServers: {
            volumes: {
              isValid: true,
              isDisabled: false,
              jobConfig: {
                status: JobStatus.Active,
              },
            },
          },
        },
        relations: {
          fileServers: {
            volumes: {
              jobConfig: {
                jobRunDetails: true,
              },
            },
          },
        },
      });

      if (!config) {
        throw new NotFoundException(`Config for id ${configId} not found.`);
      }

      return config;
    } catch (error) {
      this.logger.error(
        `Error fetching config with relations: ${error.message}`,
      );
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to fetch config details. ${error.message}`,
      );
    }
  }

  private extractValidJobConfigs(config: ConfigEntity) {
    try {
      return config.fileServers.flatMap((fileServer) =>
        fileServer.volumes.flatMap((volume) =>
          volume.jobConfig
            .filter((jobConfig) => {
              const isCompletedCutOverExits =
                jobConfig.jobType === JobType.CutOver &&
                jobConfig.status === JobStatus.Active &&
                jobConfig.jobRunDetails.some(
                  (jobRun) => jobRun.status === JobRunStatus.Errored,
                );
              const isAnyCompletedActiveMigrationExists =
                jobConfig.jobType === JobType.Migrate &&
                jobConfig.status !== JobStatus.InActive &&
                jobConfig.jobRunDetails.some(
                  (jobRun) => jobRun.status === JobRunStatus.Completed,
                );
              return (
                isCompletedCutOverExits || isAnyCompletedActiveMigrationExists
              );
            })
            .map((job) => ({
              protocol: fileServer.protocol,
              sourcePathId: job.sourcePathId,
              targetPathId: job.targetPathId,
              jobConfig: {
                id: job.id,
                jobType: job.jobType,
                jobRunDetails: job.jobRunDetails.map((runDetail) => ({
                  id: runDetail.id,
                  status: runDetail.status,
                })),
              },
            })),
        ),
      );
    } catch (error) {
      this.logger.error(`Error extracting valid job configs: ${error.message}`);
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to extract valid job configurations. ${error.message} `,
      );
    }
  }

  private async getVolumeDetailsMap(validJobConfigs: any[]) {
    try {
      const volumeIds = [
        ...new Set(
          validJobConfigs.flatMap((job) => [
            job.sourcePathId,
            job.targetPathId,
          ]),
        ),
      ].filter(Boolean);

      if (volumeIds.length === 0) {
        throw new NotFoundException(
          'No valid volumes found for the given config.',
        );
      }

      const volumeDetails = await this.volumes.find({
        where: { id: In(volumeIds) },
        relations: ['fileServer', 'fileServer.config'],
        select: {
          id: true,
          volumePath: true,
          isValid: true,
          isDisabled: true,
          fileServer: {
            id: true,
            config: {
              id: true,
              configName: true,
            },
          },
        },
      });

      if (!volumeDetails.length) {
        throw new NotFoundException('Volume details not found.');
      }

      return new Map(
        volumeDetails
          .filter((v) => v.isValid && !v.isDisabled)
          .map((volume) => [
            volume.id,
            {
              id: volume.id,
              sourcePathName: volume.volumePath,
              destinationPathName: volume.volumePath,
              configId: volume.fileServer?.config?.id || '',
              configName: volume.fileServer?.config?.configName || '',
            },
          ]),
      );
    } catch (error) {
      this.logger.error(`Error fetching volume details: ${error.message}`);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to retrieve volume details. ${error.message}`,
      );
    }
  }

  private constructResponse(
    validJobConfigs: any[],
    volumeMap: Map<string, any>,
  ) {
    try {
      return validJobConfigs.map((job) => ({
        protocol: job.protocol,
        sourcePath: volumeMap.get(job.sourcePathId)
          ? {
              id: volumeMap.get(job.sourcePathId)?.id,
              sourcePathName: volumeMap.get(job.sourcePathId)?.sourcePathName,
            }
          : { id: '', sourcePathName: '' },

        destinationFileServer: volumeMap.get(job.targetPathId)
          ? {
              id: volumeMap.get(job.targetPathId)?.configId,
              destinationFileServerName: volumeMap.get(job.targetPathId)
                ?.configName,
            }
          : {},

        destinationPath: volumeMap.get(job.targetPathId)
          ? {
              id: volumeMap.get(job.targetPathId)?.id,
              destinationPathName: volumeMap.get(job.targetPathId)
                ?.destinationPathName,
            }
          : { id: '', destinationPathName: '' },

        jobConfig: [job.jobConfig],
      }));
    } catch (error) {
      this.logger.error(`Error constructing response: ${error.message}`);
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to construct response.${error.message}`,
      );
    }
  }

  async isAllWorkerUnHealthy(workers: WorkerEntity[]): Promise<boolean> {
    const currentTime = new Date();
    return workers.every((worker) => {
      const diffInSeconds = Math.floor(
        Math.abs(
          currentTime.getTime() - new Date(worker?.stats?.updatedAt).getTime(),
        ) / 1000,
      );

      return diffInSeconds >= this.timeout;
    });
  }

  async createConfiguration(
    createConfig: ConfigDTO,
    userId: string,
    traceId: string,
    projectId?: string,
  ) {
    this.logger.debug('Config creation started');

    let managementServerId: string | null = null;

    // Sanitize configName input
    const sanitizedConfigName = await this.sanitizeConfigName(
      createConfig.configName,
    );

    const credentials: Credentials[] = [];
    let allUnHealthy = false;
    try {
      await this.isConfigNameUnique(
        createConfig.projectId,
        sanitizedConfigName,
      );

     
      const fileServerPromises = createConfig.fileServers.map(
        async (fileServer) => {
          const workers = await this.WorkerEntity.find({
            where: { workerId: In(fileServer.workers) },
          });
          credentials.push({
            details: {
              hostname: fileServer.host.trim(),
              username: fileServer.userName,
              password: fileServer?.password,
            },
            protocol: fileServer.protocol,
            workers: workers.map((it) => it.workerId),
            exportPathSource: fileServer.exportPathSource,
          });

          
          return this.fileServerEntity.create({
            host: fileServer.host.trim(),
            fileServerName : fileServer.fileServerName,
            workers: workers,
            createdBy: userId,
            protocol: fileServer.protocol,
            protocolVersion: fileServer.protocolVersion,
            userName: fileServer.userName,
            password: fileServer?.password,
            isRefreshed: false,
            volumes: [],
            exportPathSource: fileServer.exportPathSource,
            zone_id: fileServer.zone_id,
          });
        },
      );
      const allWorkerIds = createConfig.fileServers.flatMap(fs => fs.workers);
      // To fetch all workers associated with all the file servers of the config
      const workers: WorkerEntity[] = await this.WorkerEntity.find({
        where: { workerId: In(allWorkerIds) },
        relations: { stats: true },
      });

      const hasWorkers = createConfig?.fileServers?.some(
        (fs) => fs?.workers?.length > 0,
      );
      let config;
      switch (createConfig.serverType) {
        case ServerType.dell:
          config = this.configEntity.create({
            configName: sanitizedConfigName,
            configType: createConfig.configType,
            projectId: createConfig.projectId,
            status: hasWorkers ? ConfigStatus.IN_PROGRESS : ConfigStatus.DRAFT,
            fileServers: await Promise.all(fileServerPromises),
            createdBy: userId,
            hostname: createConfig.managementHost,
            port: createConfig.managementPort,
            serverType: createConfig.serverType,
            username: createConfig.managementUsername,
            password: createConfig.managementPassword,
            tlsAccepted: createConfig.tlsAccepted,
            tlsCaCertificate: createConfig.tlsCertificate,
            tlsExpiry: createConfig.tlsExpiry,
          });
          break;
        default:
          config = this.configEntity.create({
            configName: sanitizedConfigName,
            configType: createConfig.configType,
            projectId: createConfig.projectId,
            status: hasWorkers ? ConfigStatus.IN_PROGRESS : ConfigStatus.DRAFT,
            fileServers: await Promise.all(fileServerPromises),
            createdBy: userId,
            serverType: createConfig.serverType,
          });
          break;
      }

      if (workers?.length > 0 && (await this.isAllWorkerUnHealthy(workers)))
        allUnHealthy = true;
      if (allUnHealthy) {
        config.status = ConfigStatus.ERRORED;
        config.errorMessage = ConfigErrorMsg.ERRORED;
      }
      const update = await this.configEntity.save(config);
      if (allUnHealthy) {
        return update;
      }

      // For Dell Isilon, discover exports via API before starting workflow
      // This bypasses showmount command - workers will still validate by mounting
      if (createConfig.serverType === ServerType.dell) {
        this.logger.log(`Discovering Isilon exports for config ${update.id} before workflow`);
        await this.discoverIsilonExports(update.id, traceId).catch((error) => {
          this.logger.error(
            `Error discovering Isilon exports for config ${update.id}: ${error.message}`,
          );
          // Don't fail config creation if discovery fails
        });
      }

      await this.startValidateWorkingDirectoryWorkflow(
        createConfig,
        update.id,
        traceId,
      );
      const workerNames = config.fileServers.flatMap((fileServer) => {
        return fileServer.workers.map((worker) => {
          return worker?.workerName;
        });
      });

      await this.sendMailService.sendMail({
        successEmailType: SuccessEmailType.CREATE_CONFIGURATION,
        traceId,
        projectId,
        createConfig: {
          configName: update.configName,
          serverType: update.serverType,
          fileServers: update.fileServers.map((fs) => ({
            host: fs.host,
            protocol: fs.protocol,
            workerNames: fs.workers.map((w) => w.workerName),
          })),
        },
      });
      const workingDirectory =
        this.fileServerWorkingDirectoryMappingEntity.create({
          pathName: createConfig?.workingDirectory?.pathName,
          pathId: createConfig?.workingDirectory?.pathId,
          workingDirectory: createConfig?.workingDirectory?.workingDirectory,
          configId: update.id,
          createdBy: userId,
        });
      await this.fileServerWorkingDirectoryMappingEntity.save(workingDirectory);
      this.refreshConfig(update.id, traceId);
      this.logger.debug("############################# ASHISH  ENDS #############################");
      return update;
    } catch (error) {
      this.logger.error(
        `Error Occurred during creating Config ${error} for request ${traceId}`,
      );
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Error Occurred during creating Config ${error.message}`,
      );
    }
    
  }

  async updateConfiguration(
    id: string,
    updateConfig: ConfigDTO,
    userId: string,
    traceId: string,
    projectId?: string
  ) {
    try {
      if (!isUUID(id)) throw new BadRequestException('Invalid configId');
      const config = await this.configEntity.findOne({
        where: { id },
        relations: {
          fileServers: {
            workers: true,
            volumes: true,
          },
        },
      });

      if (!config)
        throw new NotFoundException(`Config for id ${id} not found.`);

      const credentials: Credentials[] = [];
      let allUnHealthy = false;
      const hasPathName = updateConfig?.workingDirectory?.pathName?.length > 0;
      const hasWorkers = updateConfig?.fileServers?.some(
        (fs) => fs?.workers?.length > 0,
      );

      config.configName = updateConfig.configName;
      config.configType = updateConfig.configType;
      config.createdBy = updateConfig.createdBy || userId;
      config.updatedBy = userId;
      config.serverType = updateConfig.serverType;
      config.status = hasWorkers
        ? hasPathName
          ? ConfigStatus.IN_PROGRESS
          : ConfigStatus.ACTIVE
        : ConfigStatus.DRAFT;

      // Update Dell serverType specific fields
      if (updateConfig.serverType === ServerType.dell) {
        config.hostname = updateConfig.managementHost;
        config.port = updateConfig.managementPort;
        config.username = updateConfig.managementUsername;
        config.password = updateConfig.managementPassword;
        config.tlsAccepted = updateConfig.tlsAccepted;
        config.tlsCaCertificate = updateConfig.tlsCertificate;
        config.tlsExpiry = updateConfig.tlsExpiry;
      }

      const fileServerPromises = config.fileServers.map(async (fileServer) => {
        const update = updateConfig.fileServers.find(
          (it) => it.id == fileServer.id,
        );
        const workers = Array.isArray(update?.workers)
          ? await this.WorkerEntity.find({
              where: { workerId: In(update.workers) },
            })
          : [];

        const workersWithStats: WorkerEntity[] = Array.isArray(update?.workers)
          ? await this.WorkerEntity.find({
              where: { workerId: In(update.workers) },
              relations: { stats: true },
            })
          : [];

        if (
          workersWithStats?.length > 0 &&
          (await this.isAllWorkerUnHealthy(workersWithStats))
        )
          allUnHealthy = true;

        credentials.push({
          details: {
            hostname: update.host,
            username: update.userName,
            password: update?.password,
          },
          protocol: fileServer.protocol,
          workers: workers.map((it) => it.workerId),
        });

        return this.fileServerEntity.create({
          id: fileServer.id,
          host: update.host.trim(),
          fileServerName: update.fileServerName,
          workers: workers,
          createdBy: fileServer.createdBy,
          protocol: fileServer.protocol,
          protocolVersion: update?.protocolVersion,
          userName: update.userName || fileServer.userName,
          volumes: fileServer.volumes,
          password: update.password,
          updatedBy: userId,
          isRefreshed: false,
          exportPathSource: update.exportPathSource,
          zone_id: update.zone_id,
        });
      });

      const { workingDirectory } = updateConfig;
      const mapping =
        await this.fileServerWorkingDirectoryMappingEntity.findOne({
          where: { configId: id },
        });
      if (!mapping) {
        this.logger.error(
          `Mapping for configId ${id} not found for request ${traceId}`,
        );
        throw new NotFoundException(`Mapping for configId ${id} not found`);
      }

      Object.assign(mapping, {
        pathName: workingDirectory?.pathName ?? mapping?.pathName,
        workingDirectory:
          workingDirectory?.workingDirectory ?? mapping?.workingDirectory,
        pathId: workingDirectory?.pathId ?? mapping?.pathId,
      });

      await this.fileServerWorkingDirectoryMappingEntity.save(mapping);

      const existingWorkers = config.fileServers.flatMap(
        (fileServer) => fileServer.workers,
      );
      config.fileServers = await Promise.all(fileServerPromises);
      const newWorkers = updateConfig.fileServers.flatMap((fileServer) =>
        Array.isArray(fileServer.workers) ? fileServer.workers : [],
      );
      const removedWorkers = existingWorkers.filter(
        (worker) => !newWorkers.includes(worker.workerId),
      );

      const addedWorkerIds = newWorkers.filter(
        (workerId) => !existingWorkers.some((w) => w.workerId === workerId),
      );

      const addedWorkers =
        addedWorkerIds.length > 0
          ? await this.WorkerEntity.find({
              select: {
                workerId: true,
                workerName: true,
              },
              where: { workerId: In(addedWorkerIds) },
            })
          : [];

      if (allUnHealthy) {
        config.status = ConfigStatus.ERRORED;
        config.errorMessage = ConfigErrorMsg.ERRORED;
      }

      const update = await this.configEntity.save(config);
      if (allUnHealthy) {
        return update;
      }
      await this.sendMailService.sendMail({
        successEmailType: SuccessEmailType.UPDATE_CONFIGURATION,
        traceId,
        projectId,
        createConfig: {
          configName: update.configName,
          serverType: update.serverType,
          fileServers: update.fileServers.map((fs) => ({
            host: fs.host,
            protocol: fs.protocol,
            workerNames: fs.workers.map((w) => w.workerName),
            addedWorkers: addedWorkers.map((w) => w.workerName),
            removedWorkers: removedWorkers.map((w) => w.workerName),
          })),
        },
      });

      await this.startValidateWorkingDirectoryWorkflow(
        updateConfig,
        update.id,
        traceId,
      );

      await this.volumes.update(
        {
          fileServerId: In(update.fileServers.map((fs) => fs.id)),
          isDisabled: false,
        },
        { isDisabled: true },
      );
      this.refreshConfig(update.id, traceId);

      return update;
    } catch (error) {
      this.logger.error(
        `Error Occurred during updating Config ${error.message} for traceId ${traceId}`,
      );

      // If the error is a NotFoundException, re-throw it
      if (error instanceof NotFoundException) {
        throw error;
      }

      // Otherwise, throw an InternalServerErrorException for any other errors
      throw new InternalServerErrorException(
        `Error Occurred during updating Config ${error.message}`,
      );
    }
  }

  async startValidateWorkingDirectoryWorkflow(
    createConfig: ConfigDTO,
    configId: string,
    traceId: string,
  ) {
    // Validate input parameters - throw InternalServerErrorException if any required parameter is empty
    if (!createConfig || !configId || !traceId || !createConfig.fileServers || createConfig.fileServers.length === 0) {
      throw new InternalServerErrorException(
        'Failed to start ValidateWorkingDirectoryWorkflow. Invalid input parameters.'
      );
    }

    try {
      const listPathPayload: ListPathDTO[] = [];
      const isDell = createConfig.serverType === ServerType.dell;

      // For Dell, fetch first discovered export for each file server from DB
      let dellExportsMap: Map<string, string> = new Map();
      if (isDell) {
        // Get config with file servers to get their IDs
        const config = await this.configEntity.findOne({
          where: { id: configId },
          relations: ['fileServers'],
        });

        if (config?.fileServers) {
          for (const fs of config.fileServers) {
            // Fetch first volume (export) for this file server
            const firstVolume = await this.volumes.findOne({
              where: { fileServerId: fs.id },
              order: { createdAt: 'ASC' },
            });
            if (firstVolume?.volumePath) {
              // Map file server host to first export path
              dellExportsMap.set(fs.host, firstVolume.volumePath);
              this.logger.debug(`Dell: First export for ${fs.host} is ${firstVolume.volumePath}`);
            }
          }
        }
      }

      createConfig?.fileServers?.forEach((fileServer) => {
        const payload: ListPathDTO = {
          type: fileServer?.protocol,
          protocolVersion: fileServer?.protocolVersion?.replace(/^v/, ''),
          host: fileServer?.host?.trim(),
          username: fileServer?.userName,
          password: fileServer?.password,
          exportPathSource: fileServer.exportPathSource,
        };
        listPathPayload.push(payload);
      });

      // For Dell, include first discovered exports in payload so workers can mount without showmount
      const dellDiscoveredPaths = isDell 
        ? Array.from(dellExportsMap.values()) 
        : [];

      const payload: ValidateExportPathAndWorkingDirectoryDTO = {
        exportPath: createConfig?.workingDirectory?.pathName,
        workingDirectory: createConfig?.workingDirectory?.workingDirectory,
        configId: configId,
        workerIds: [],
        listPathPayload,
        serverType: createConfig?.serverType, // Pass serverType so workers can skip showmount for Dell
        options: new Options(),
      };

      // Add Dell-specific data to payload
      if (isDell && dellDiscoveredPaths.length > 0) {
        (payload as any).discoveredPaths = dellDiscoveredPaths;
        (payload as any).dellExportsMap = Object.fromEntries(dellExportsMap);
      }

      createConfig?.fileServers?.forEach((fileServer) => {
        fileServer?.workers?.forEach((worker) => {
          if (!payload.workerIds.includes(worker))
            payload.workerIds.push(worker);
        });
      });

      if (payload?.workerIds?.length > 0) {
        this.logger.debug('started ValidateWorkingDirectoryWorkflow');
        const startWorkFlowPayload: StartWorkFlowPayload = {
          workflowId:
            WorkFlows.VALIDATE_EXPORT_PATH_AND_WORKING_DIRECTORY +
            '-' +
            traceId,
          taskQueue: 'ParentWorkflow-TaskQueue',
          args: [
            {
              traceId: traceId,
              payload: { traceId, ...payload },
              options: payload.options,
            },
          ],
          ...payload.options,
        };

        await this.workFlowService.startWorkflow(
          WorkFlows.VALIDATE_EXPORT_PATH_AND_WORKING_DIRECTORY,
          startWorkFlowPayload,
        );
        this.logger.debug(
          'completed ValidateWorkingDirectoryWorkflow successfully',
        );
      }
    } catch (error) {
      this.logger.error(
        `Error while starting ValidateWorkingDirectoryWorkflow - ${error.message}`,
      );
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to start ValidateWorkingDirectoryWorkflow. ${error.message}`,
      );
    }
  }

  async remove(id: string) {
    try {
      if (!isUUID(id)) throw new BadRequestException('Invalid configId');
      const config = await this.configEntity.findOne({
        where: { id },
      });
      return await this.configEntity.remove(config);
    } catch (error) {
      this.logger.error(`Error removing config: ${error.message}`);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to remove config.');
    }
  }

  /**
   * Discover exports/shares from Dell Isilon using REST API
   * Called after config creation for Dell to bypass showmount
   * Workers will still validate by mounting these discovered exports
   */
  async discoverIsilonExports(configId: string, traceId: string): Promise<void> {
    try {
      this.logger.log(`Discovering Isilon exports for config ${configId} (trace: ${traceId})`);

      // Fetch config with file servers
      const config = await this.configEntity.findOne({
        where: { id: configId },
        relations: ['fileServers'],
      });

      if (!config) {
        throw new NotFoundException(`Config ${configId} not found`);
      }

      if (config.serverType !== ServerType.dell) {
        this.logger.warn(`Config ${configId} is not Dell Isilon (${config.serverType}), skipping API discovery`);
        return;
      }

      this.logger.log(`Processing ${config.fileServers.length} file servers for config ${configId}`);

      // For each file server (zone), fetch exports and shares
      for (const fileServer of config.fileServers) {
        this.logger.log(`Fetching exports for file server ${fileServer.id} (zone: ${fileServer.fileServerName})`);

        const exportPaths: VolumeEntity[] = [];

        // Fetch NFS exports if protocol includes NFS
        if (fileServer.protocol === Protocol.NFS) {
          try {
            const nfsExports = await this.isilonStorageClient.getNFSExportPaths(fileServer.id);
            this.logger.log(`Found ${nfsExports.length} NFS exports for file server ${fileServer.id}`);

            for (const nfsExport of nfsExports) {
              const volume = this.volumes.create({
                volumePath: nfsExport.path,
                fileServerId: fileServer.id,
                isValid: true, // Mark as valid from API, workers will validate accessibility
                isDisabled: false,
                reachableCount: 0,
              });
              exportPaths.push(volume);
            }
          } catch (error) {
            this.logger.error(`Failed to fetch NFS exports for file server ${fileServer.id}: ${error.message}`);
            // Continue with other file servers even if one fails
          }
        }

        // Fetch SMB shares if protocol includes SMB
        if (fileServer.protocol === Protocol.SMB) {
          try {
            const smbShares = await this.isilonStorageClient.getSMBShares(fileServer.id);
            this.logger.log(`Found ${smbShares.length} SMB shares for file server ${fileServer.id}`);

            for (const smbShare of smbShares) {
              const volume = this.volumes.create({
                volumePath: smbShare.name, // For SMB, use share name
                fileServerId: fileServer.id,
                isValid: true, // Mark as valid from API, workers will validate accessibility
                isDisabled: false,
                reachableCount: 0,
              });
              exportPaths.push(volume);
            }
          } catch (error) {
            this.logger.error(`Failed to fetch SMB shares for file server ${fileServer.id}: ${error.message}`);
            // Continue with other file servers even if one fails
          }
        }

        // Save all discovered exports/shares for this file server
        if (exportPaths.length > 0) {
          await this.volumes.save(exportPaths);
          this.logger.log(`Saved ${exportPaths.length} exports for file server ${fileServer.id}`);
        } else {
          this.logger.warn(`No exports found for file server ${fileServer.id}`);
        }
      }

      this.logger.log(`Completed Isilon export discovery for config ${configId}`);
    } catch (error) {
      this.logger.error(`Error discovering Isilon exports for config ${configId}: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to discover Isilon exports: ${error.message}`
      );
    }
  }

  async refreshConfig(configId: string, traceId: string) {
    try {
      if (!isUUID(configId)) {
        throw new BadRequestException('Invalid UUID format');
      }
      // check refresh eligibility
      const refreshStatus = await this.isRefreshPossible(configId);
      if (!refreshStatus.isRefreshAvailable) {
        this.logger.warn(`Refresh not available for configId: ${configId}. Reason: ${refreshStatus.message}`);
        throw new BadRequestException(
          refreshStatus.message || 'Refresh not available for this configuration.',
        );
      }

      const config = await this.configEntity.findOne({
        where: { id: configId },
        relations: { fileServers: { workers: true } },
      });

      if (!config) {
        throw new NotFoundException(
          `Config Not found with config id ${configId}`,
        );
      }

      const payload: CreateRequestDto = {
        fileServer: {
          hostname: '',
          protocols: [],
        },
        options: new Options(),
        workerIds: [],
      };

      config.fileServers?.forEach((fileServer) => {
        payload.fileServer.hostname = fileServer.host;
        payload.fileServer.protocols.push({
          type: fileServer.protocol,
          username: fileServer.userName,
          password: fileServer.password,
          exportPathSource: fileServer.exportPathSource,
        });
        fileServer?.workers?.forEach((worker) => {
          if (!payload.workerIds.includes(worker.workerId))
            payload.workerIds.push(worker.workerId);
        });
      });

      if (payload.workerIds.length === 0) return;

      await this.fileServerEntity.update(
        { id: In(config.fileServers.map((it) => it.id)) },
        { isRefreshed: false },
      );

      const startWorkFlowPayload: StartWorkFlowPayload = {
        workflowId: WorkFlows.LIST_PATHS + '-' + traceId,
        taskQueue: 'ParentWorkflow-TaskQueue',
        args: [
          {
            traceId: traceId,
            payload: { traceId, ...payload },
            options: payload.options,
          },
        ],
        ...payload.options,
      };

      const workflow = await this.workFlowService.startWorkflow(
        WorkFlows.LIST_PATHS,
        startWorkFlowPayload,
      );
      this.updateResult(workflow.workflowId, configId);
      return { workflowId: workflow.workflowId };
    } catch (error) {
      this.logger.error(`Error refreshing config: ${error.message}`);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to refresh config. ${error.message}`,
      );
    }
  }

  async updateResult(id: string, configId: string) {
    try {
      setTimeout(async () => {
        try {
          const details: ListPathWorkflowStatus =
            (await this.workFlowService.getWorkFlowRes(
              id,
            )) as ListPathWorkflowStatus;

          if (!details) {
            this.logger.warn(`No workflow details found for workflowId: ${id}`);
            return;
          }

          if (details.status === WorkflowExecutionStatus.COMPLETED) {
            await this.updatePaths(configId, details);
          } else {
            this.logger.warn(
              `Workflow ${id} did not complete. Status: ${details.status}`,
            );
          }
        } catch (error) {
          this.logger.error(`Error fetching workflow result: ${error.message}`);
        }
      }, 2000);
    } catch (error) {
      this.logger.error(`Unexpected error in updateResult: ${error.message}`);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to update workflow result. ${error.message}`,
      );
    }
  }

  async updatePaths(id: string, details: ListPathWorkflowStatus) {
    try {
      const pathsMap: PathsMap = {
        NFS: { workers: 0, paths: [] },
        SMB: { workers: 0, paths: [] },
      };
      details.completed.forEach((workflow) => {
        pathsMap[workflow.protocolType].workers++;
        workflow.paths.forEach((path) => {
          if (!pathsMap[workflow.protocolType].paths.includes(path))
            pathsMap[workflow.protocolType].paths.push(path);
        });
      });
      const config = await this.configEntity.findOne({
        select: {
          fileServers: {
            id: true,
            protocol: true,
            volumes: {
              id: true,
              volumePath: true,
            },
          },
        },
        where: { id },
        relations: {
          fileServers: {
            volumes: true,
          },
        },
      });
      const fileServersIds = config.fileServers.map((it) => it.id);
      for (const fileServer of config.fileServers) {
        await this.volumes.update(
          {
            fileServerId: fileServer.id,
            volumePath: In(pathsMap[fileServer.protocol].paths),
          },
          {
            reachableCount: pathsMap[fileServer.protocol].workers,
            isValid: true,
            isDisabled: false,
          },
        );

        const existingPaths = new Set(
          fileServer.volumes.map((vol) => vol.volumePath),
        );
        const founds: VolumeEntity[] = [];
        pathsMap[fileServer.protocol].paths.forEach((path) => {
          if (!existingPaths.has(path))
            founds.push(
              this.volumes.create({
                fileServerId: fileServer.id,
                reachableCount: pathsMap[fileServer.protocol].workers,
                volumePath: path,
                isValid: true,
                isDisabled: false,
                createdBy: config.updatedBy ?? config.createdBy,
              }),
            );
        });
        await this.volumes.save(founds);
        await this.fileServerEntity.update(
          { id: fileServer.id },
          { isRefreshed: true },
        );

        // Disable volumes that are no longer in the completed payload
        const validPaths = new Set(pathsMap[fileServer.protocol].paths);
        const pathsToDisable = fileServer.volumes
          .filter((vol) => !validPaths.has(vol.volumePath))
          .map((vol) => vol.volumePath);
        if (pathsToDisable.length > 0)
          await this.volumes.update(
            { fileServerId: fileServer.id, volumePath: In(pathsToDisable) },
            { isDisabled: true },
          );
      }

      // update job configurations to inactive if any volume is disabled or invalid associated with it
      const volumeIds = await this.volumes
        .createQueryBuilder('volume')
        .select('volume.id')
        .where('volume.file_server_id IN (:...fileServersIds)', {
          fileServersIds: fileServersIds,
        })
        .andWhere('volume.is_valid = :isValid', { isValid: false })
        .orWhere('volume.is_disabled = :isDisabled', { isDisabled: true })
        .getMany();

      if (volumeIds.length > 0) {
        const volumeIdList = volumeIds.map((vol) => vol.id);
        await this.jobConfigRepo
          .createQueryBuilder('jobConfig')
          .update()
          .set({ status: JobStatus.InActive })
          .where(
            'jobConfig.source_path_id IN (:...volumeIds) OR jobConfig.target_path_id IN (:...volumeIds)',
            { volumeIds: volumeIdList },
          )
          .andWhere('jobConfig.status = :status', { status: JobStatus.Active })
          .execute();
      }

      await this.configEntity.update({ id }, { scannedDate: new Date() });
    } catch (error) {
      this.logger.error(`Error in updatePaths: ${error.message}`);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to update paths ${error.message}`,
      );
    }
  }

  async isRefreshPossible(configId: string): Promise<{ isRefreshAvailable: boolean; message?: string }> {
    try {
      const fileServers = await this.configEntity.find({
        where: { id: configId },
        relations: { fileServers: { volumes: true } },
      });

      const volumeIds = fileServers.flatMap((fs) =>
        fs.fileServers.flatMap((v) => v.volumes.map((vol) => vol.id)),
      ); // volume ids from all file servers
      if (volumeIds.length === 0) {
        this.logger.warn(`No valid volumes found for config ID ${configId}.`);
        return { isRefreshAvailable: true }; // No volumes means no jobs, so refresh is possible
      }

      /*
        fetch all the job configurations that has any of the volumeIds in
        their sourcePathId or targetPathId and status is ACTIVE
      */
      const jobConfigs = await this.jobConfigRepo.find({
          where: [{
              status: JobStatus.Active,
              sourcePathId: In(volumeIds),
            }, {
              status: JobStatus.Active,
              targetPathId: In(volumeIds),
          }]
      })
      // check if any job config has schedule as SCHEDULING if yes then return false
      if (jobConfigs.some((jc) => jc.scheduler === 'SCHEDULING')) {
        const userMessage = `Job scheduling in progress. Please retry shortly.`;
        const logMessage = `Refresh is not possible for configuration ${configId} as there are jobs with SCHEDULING status : ${JSON.stringify(jobConfigs.filter((jc) => jc.scheduler === 'SCHEDULING'))}`;
        this.logger.warn(logMessage);
        return { isRefreshAvailable: false, message: userMessage };
      }

      // check if futureScheduleAt is not null for any job config, if yes then return false
      if (jobConfigs.some((jc) => !!jc.futureScheduleAt)) {
        const userMessage = `Jobs are scheduled for future execution. Please cancel or reschedule these jobs before refreshing.`;
        const logMessage = `Refresh is not possible for configuration ${configId} as there are jobs with futureScheduleAt set: ${JSON.stringify(jobConfigs.filter((jc) => !!jc.futureScheduleAt))}`;
        this.logger.warn(logMessage);
        return { isRefreshAvailable: false, message: userMessage };
      }

      // fetch all the jobs that are in running state for above job configurations
      const runningJobs = await this.jobRunRepo.count({
        where: {
          jobConfigId: In(jobConfigs.map((jc) => jc.id)),
          status: In([
            JobRunStatus.Running,
            JobRunStatus.Ready,
            JobRunStatus.Paused,
          ]),
        },
      });

      if (runningJobs > 0) {
        const userMessage = `Jobs are currently running. Please wait for active jobs to complete and try again.`;
        const logMessage = `Refresh is not possible for configuration ${configId} as there are currently running jobs`;
        this.logger.warn(logMessage);
        return { isRefreshAvailable: false, message: userMessage };
      }

      this.logger.log(`Refresh is possible for configuration ${configId}`);
      return { isRefreshAvailable: true };
    } catch (error) {
      this.logger.error(`Error checking refresh possibility for config ${configId}: ${error.message}`);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to check refresh possibility. ${error.message}`,
      );
    }
  }

  async isUploadInProgress(fileServerIds: string[]): Promise<boolean> {
    try {
      const latestUpload = await this.pathUploadsRepo.findOne({
        where: { fileServerId: In(fileServerIds) },
        order: { createdAt: 'DESC' },
        select: ['uploadId'],
      });
      const uploadId = latestUpload?.uploadId;
      if (!uploadId) {
        this.logger.warn(
          `No uploads found for file server IDs: ${fileServerIds.join(', ')}`,
        );
        return false;
      }

      const workflowId = WorkFlows.VALIDATE_PATHS + '-' + uploadId;
      const workflowRes = await this.workFlowService.getWorkFlowRes(workflowId);
      if (!workflowRes) {
        this.logger.warn(`No workflow found for upload ID: ${uploadId}`);
        return false;
      }
      const isUploadInProgress =
        workflowRes.status === WorkflowExecutionStatus.RUNNING;
      this.logger.log(
        `Upload with ID ${uploadId} is in progress: ${isUploadInProgress}`,
      );
      return isUploadInProgress;
    } catch (error) {
      this.logger.error(`Error checking upload in progress: ${error.message}`);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      return false;
    }
  }

  // fetch host name and port from host string
  async fetchCertificate(request: FetchCertificateRequestDTO): Promise<FetchCertificateResponseDTO> {
    const { host } = request;
    // Delegate to IsilonStorageClient which has the implementation
    
    switch (request.serverType) {
      case ServerType.dell:
        return await this.isilonStorageClient.fetchCertificate(host);  
      default:
        throw new BadRequestException(
          `Unsupported server type: ${request.serverType}`
        );
    }
  }

  async fetchZones(request: FetchZonesRequestDTO): Promise<FetchZonesResponseDTO> {
    // Route to appropriate storage client based on server type
    switch (request.serverType) {
      case ServerType.dell:
        return await this.isilonStorageClient.fetchZones(request);   
      default:
        throw new BadRequestException(
          `Unsupported server type: ${request.serverType}`
        );
    }
  }

  async validateConnection(request: FetchZonesRequestDTO): Promise<{ isValid: boolean; message: string }> {
    try {
      // Route to appropriate storage client based on server type
      let isValid = false;
      
      switch (request.serverType) {
        case ServerType.dell:
          isValid = await this.isilonStorageClient.validateConnection(request);
          break;
        default:
          throw new BadRequestException(
            `Unsupported server type: ${request.serverType}`
          );
      }

      if (isValid) {
        return {
          isValid: true,
          message: 'Connection validated successfully'
        };
      } else {
        return {
          isValid: false,
          message: 'Connection validation failed'
        };
      }
    } catch (error) {
      this.logger.error(`Connection validation error: ${error.message}`);
      return {
        isValid: false,
        message: error.message || 'Connection validation failed'
      };
    }
  }
}
