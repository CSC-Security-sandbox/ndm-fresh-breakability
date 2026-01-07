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
  DiscoveredVolumeData,
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
            status: true,  // Per-zone status for Dell Isilon
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

  async getConfigById(id: string, fileServerId?: string) {
    try {
      if (!isUUID(id)) throw new BadRequestException('Invalid configId');
      if (fileServerId && !isUUID(fileServerId)) throw new BadRequestException('Invalid fileServerId');

      const config = await this.configEntity.findOne({
        select: {
          id: true,
          configName: true,
          configType: true,
          projectId: true,
          scannedDate: true,
          status: true,
          errorMessage: true,
          // Dell Isilon management console fields
          serverType: true,
          hostname: true,
          port: true,
          username: true,
          tlsAccepted: true,
          tlsCaCertificate: true,
          tlsExpiry: true,
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
            status: true,  // Per-zone status for Dell Isilon
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
          // For Storage Aware: Always show volumes regardless of status (per-zone visibility)
          // For Other NAS: Clear volumes if config is DRAFT/ERRORED
          if (config.serverType === ServerType.other) {
            config.fileServers = config.fileServers.map((server) => ({
              ...server,
              volumes: [],
            }));
          }
        }
      }
      // Mask sensitive information
      if (config?.fileServers) {
        config.fileServers = config.fileServers.map((fileServer) => ({
          ...fileServer,
          password: '',
        }));
      }
      
      // Filter by fileServerId if provided
      if (fileServerId && config?.fileServers) {
        config.fileServers = config.fileServers.filter(
          (fs) => fs.id === fileServerId
        );
        if (config.fileServers.length === 0) {
          throw new NotFoundException(`File server with id ${fileServerId} not found in config ${id}`);
        }
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

      // Build hashmap of hasWorkers per file server (keyed by fileServerName)
      const hasWorkersMap: Record<string, boolean> = {};
      createConfig.fileServers.forEach((fs) => {
        hasWorkersMap[fs.fileServerName] = (fs?.workers?.length ?? 0) > 0;
      });
     
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
            status: hasWorkersMap[fileServer.fileServerName] ? ConfigStatus.IN_PROGRESS : ConfigStatus.DRAFT,
          });
        },
      );
      const allWorkerIds = createConfig.fileServers.flatMap(fs => fs.workers);
      // To fetch all workers associated with all the file servers of the config
      const workers: WorkerEntity[] = await this.WorkerEntity.find({
        where: { workerId: In(allWorkerIds) },
        relations: { stats: true },
      });
      
      
      // Config-level status check
      // For Dell: DRAFT if ANY file server has no workers (priority over IN_PROGRESS)
      // For Other NAS: Only one file server, so same logic applies
      const hasDraft = Object.values(hasWorkersMap).some(v => !v);  // TRUE if any file server has no workers
      const hasWorkers = Object.values(hasWorkersMap).some(v => v);  // TRUE if any file server has workers
      
      // Determine initial config status
      // Priority: DRAFT (if any zone has no workers) > IN_PROGRESS (if any zone has workers)
      const initialConfigStatus = hasDraft ? ConfigStatus.DRAFT : (hasWorkers ? ConfigStatus.IN_PROGRESS : ConfigStatus.DRAFT);
      
      let config;
      switch (createConfig.serverType) {
        case ServerType.dell:
          config = this.configEntity.create({
            configName: sanitizedConfigName,
            configType: createConfig.configType,
            projectId: createConfig.projectId,
            status: initialConfigStatus,
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
            status: initialConfigStatus,
            fileServers: await Promise.all(fileServerPromises),
            createdBy: userId,
            serverType: createConfig.serverType,
          });
          break;
      }

      // Check worker health at config level
      if (workers?.length > 0 && (await this.isAllWorkerUnHealthy(workers)))
        allUnHealthy = true;
      if (allUnHealthy) {
        config.status = ConfigStatus.ERRORED;
        config.errorMessage = ConfigErrorMsg.ERRORED;
      }

      // Check worker health at file server level
      for (const fileServer of config.fileServers) {
        if (fileServer.workers?.length > 0) {
          // Get worker IDs from the already-populated workers relation
          const workerIds = fileServer.workers.map(w => w.workerId);
          
          const fsWorkers: WorkerEntity[] = await this.WorkerEntity.find({
            where: { workerId: In(workerIds) },
            relations: { stats: true },
          });
          
          if (fsWorkers?.length > 0 && (await this.isAllWorkerUnHealthy(fsWorkers))) {
            fileServer.status = ConfigStatus.ERRORED;
            fileServer.errorMessage = ConfigErrorMsg.ERRORED;
          }
        }
      }
      const update = await this.configEntity.save(config);
      if (allUnHealthy) {
        return update;
      }

      // For Dell, discover exports via API for workflow payload
      // NOTE: We do NOT save volumes here - refreshConfig will handle that
      // This just discovers exports for the validation workflow
      let discoveredPathsMap: Map<string, DiscoveredVolumeData[]> | null = null;
      if (createConfig.serverType === ServerType.dell) {
        this.logger.log(`Discovering Isilon exports for config ${update.id} for workflow payload`);
        try {
          discoveredPathsMap = await this.discoverIsilonExports(update.id, traceId);
          this.logger.log(`Discovered exports for ${discoveredPathsMap.size} file servers`);
        } catch (error) {
          this.logger.error(
            `Error discovering Isilon exports for config ${update.id}: ${error.message}`,
          );
          // Don't fail config creation if discovery fails
        }
      }

      await this.startValidateWorkingDirectoryWorkflow(
        createConfig,
        update.id,
        traceId,
        discoveredPathsMap, // Pass discovered paths for Dell
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
      
      // refreshConfig handles Dell (via API) and non-Dell (via workers) internally
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

      // Process existing file servers (update them)
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

      // Process new file servers (create them) - file servers with null or undefined id
      const newFileServerDTOs = updateConfig.fileServers.filter(
        (fs) => fs.id === null || fs.id === undefined,
      );

      this.logger.debug(
        `Found ${newFileServerDTOs.length} new file servers to create for config ${id}`,
      );

      const newFileServerPromises = newFileServerDTOs.map(async (newFs) => {
        const workers = Array.isArray(newFs.workers)
          ? await this.WorkerEntity.find({
              where: { workerId: In(newFs.workers) },
            })
          : [];

        const workersWithStats: WorkerEntity[] = Array.isArray(newFs.workers)
          ? await this.WorkerEntity.find({
              where: { workerId: In(newFs.workers) },
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
            hostname: newFs.host,
            username: newFs.userName,
            password: newFs.password,
          },
          protocol: newFs.protocol,
          workers: workers.map((it) => it.workerId),
        });

        this.logger.debug(
          `Creating new file server: ${newFs.fileServerName} (${newFs.protocol}) with ${workers.length} workers`,
        );

        return this.fileServerEntity.create({
          host: newFs.host.trim(),
          fileServerName: newFs.fileServerName,
          workers: workers,
          createdBy: userId,
          protocol: newFs.protocol,
          protocolVersion: newFs.protocolVersion,
          userName: newFs.userName,
          password: newFs.password,
          updatedBy: userId,
          isRefreshed: false,
          exportPathSource: newFs.exportPathSource,
          zone_id: newFs.zone_id,
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
      
      // Combine existing (updated) file servers and new file servers
      const updatedFileServers = await Promise.all(fileServerPromises);
      const createdFileServers = await Promise.all(newFileServerPromises);
      config.fileServers = [...updatedFileServers, ...createdFileServers];
      
      this.logger.debug(
        `Config ${id}: ${updatedFileServers.length} updated file servers, ${createdFileServers.length} new file servers`,
      );
      
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

              let discoveredPathsMap: Map<string, DiscoveredVolumeData[]> | null = null;
        if (updateConfig.serverType === ServerType.dell) {
        this.logger.log(`Discovering Isilon exports for config ${update.id} for workflow payload (update)`);
        try {
        discoveredPathsMap = await this.discoverIsilonExports(update.id, traceId);
        this.logger.log(`Discovered exports for ${discoveredPathsMap.size} file servers`);
        } catch (error) {
        this.logger.error(
        `Error discovering Isilon exports for config ${update.id}: ${error.message}`,
        );
        // Don't fail config update if discovery fails
        }
        }


      await this.startValidateWorkingDirectoryWorkflow(
        updateConfig,
        update.id,
        traceId,
        discoveredPathsMap
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
    discoveredPathsMap?: Map<string, DiscoveredVolumeData[]> | null, // Dell: pre-discovered exports (optional)
  ) {
    // Validate input parameters - throw InternalServerErrorException if any required parameter is empty
    if (!createConfig || !configId || !traceId || !createConfig.fileServers || createConfig.fileServers.length === 0) {
      throw new InternalServerErrorException(
        'Failed to start ValidateWorkingDirectoryWorkflow. Invalid input parameters.'
      );
    }

    try {
      const isDell = createConfig.serverType === ServerType.dell;

      if (isDell) {
        // DELL: Start one workflow per file server (zone) with fileServerId for per-zone status updates
        await this.startDellPerZoneWorkflows(createConfig, configId, traceId, discoveredPathsMap);
      } else {
        // OTHER NAS: Start single workflow for entire config (existing behavior)
        await this.startOtherNasWorkflow(createConfig, configId, traceId);
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

  /**
   * Start per-zone workflows for Dell Isilon
   * Each file server (zone) gets its own workflow with fileServerId
   */
  private async startDellPerZoneWorkflows(
    createConfig: ConfigDTO,
    configId: string,
    traceId: string,
    discoveredPathsMap?: Map<string, DiscoveredVolumeData[]> | null, // Pre-discovered exports (optional)
  ) {
    this.logger.debug(`Dell: Starting per-zone workflows for config ${configId}`);

    // Get config with file servers from DB to get their IDs
    const config = await this.configEntity.findOne({
      where: { id: configId },
      relations: ['fileServers', 'fileServers.workers'],
    });

    if (!config?.fileServers || config.fileServers.length === 0) {
      this.logger.warn(`Dell: No file servers found for config ${configId}`);
      return;
    }

    // Start a workflow for each file server (zone)
    for (const fileServer of config.fileServers) {
      // Get workers for this file server
      const workerIds = fileServer.workers?.map(w => w.workerId) || [];
      
      if (workerIds.length === 0) {
        this.logger.debug(`Dell: Skipping file server ${fileServer.id} - no workers assigned`);
        continue;
      }

      // Get discovered exports for this file server
      // Priority: 1. Pre-discovered paths passed as parameter, 2. Query from DB (for update/refresh)
      let discoveredPaths: string[] = [];
      if (discoveredPathsMap?.has(fileServer.id)) {
        const volumeDataList = discoveredPathsMap.get(fileServer.id) || [];
        discoveredPaths = volumeDataList.map(v => v.volumePath);
        this.logger.debug(`Dell: Using pre-discovered ${discoveredPaths.length} paths for file server ${fileServer.id}`);
      } else {
        // Fallback: Fetch from DB (for update scenarios where volumes exist)
        const firstVolume = await this.volumes.findOne({
          where: { fileServerId: fileServer.id },
          order: { createdAt: 'ASC' },
        });
        if (firstVolume?.volumePath) {
          discoveredPaths = [firstVolume.volumePath];
        }
        this.logger.debug(`Dell: Fetched ${discoveredPaths.length} paths from DB for file server ${fileServer.id}`);
      }

      // Build dellExportsMap with first path for this file server
      const dellExportsMap: Record<string, string> = {};
      if (discoveredPaths.length > 0) {
        dellExportsMap[fileServer.host] = discoveredPaths[0];
      }

      // Find matching fileServer from createConfig for credentials
      const fileServerConfig = createConfig.fileServers.find(
        fs => fs.host?.trim() === fileServer.host || fs.id === fileServer.id
      );

      if (!fileServerConfig) {
        this.logger.warn(`Dell: No config found for file server ${fileServer.id}`);
        continue;
      }

      const listPathPayload: ListPathDTO[] = [{
        type: fileServerConfig.protocol,
        protocolVersion: fileServerConfig.protocolVersion?.replace(/^v/, ''),
        host: fileServerConfig.host?.trim(),
        username: fileServerConfig.userName,
        password: fileServerConfig.password,
        exportPathSource: fileServerConfig.exportPathSource,
      }];

      const payload: ValidateExportPathAndWorkingDirectoryDTO = {
        exportPath: createConfig?.workingDirectory?.pathName,
        workingDirectory: createConfig?.workingDirectory?.workingDirectory,
        configId: configId,
        workerIds: workerIds,
        listPathPayload,
        serverType: createConfig.serverType,
        options: new Options(),
      };

      // Add Dell-specific data including fileServerId for per-zone status updates
      (payload as any).fileServerId = fileServer.id;
      (payload as any).discoveredPaths = discoveredPaths;
      (payload as any).dellExportsMap = dellExportsMap;

      const workflowId = `${WorkFlows.VALIDATE_EXPORT_PATH_AND_WORKING_DIRECTORY}-${traceId}-${fileServer.id}-${Date.now()}`;
      
      this.logger.debug(`Dell: Starting workflow for zone ${fileServer.fileServerName} (fileServerId: ${fileServer.id})`);

      const startWorkFlowPayload: StartWorkFlowPayload = {
        workflowId: workflowId,
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

      this.logger.debug(`Dell: Started workflow ${workflowId} for file server ${fileServer.id}`);
    }

    this.logger.debug(`Dell: Completed starting per-zone workflows for config ${configId}`);
  }

  /**
   * Start single workflow for Other NAS (existing behavior)
   */
  private async startOtherNasWorkflow(
    createConfig: ConfigDTO,
    configId: string,
    traceId: string,
  ) {
    const listPathPayload: ListPathDTO[] = [];

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

    const payload: ValidateExportPathAndWorkingDirectoryDTO = {
      exportPath: createConfig?.workingDirectory?.pathName,
      workingDirectory: createConfig?.workingDirectory?.workingDirectory,
      configId: configId,
      workerIds: [],
      listPathPayload,
      serverType: createConfig?.serverType,
      options: new Options(),
    };

    createConfig?.fileServers?.forEach((fileServer) => {
      fileServer?.workers?.forEach((worker) => {
        if (!payload.workerIds.includes(worker))
          payload.workerIds.push(worker);
      });
    });

    if (payload?.workerIds?.length > 0) {
      this.logger.debug('started ValidateWorkingDirectoryWorkflow for OtherNAS');
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
        'completed ValidateWorkingDirectoryWorkflow successfully for OtherNAS',
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
   * Discover exports/shares from Dell Isilon using REST API for ALL file servers in a config.
   * Returns a map of fileServerId -> discovered volume data.
   * 
   * This is a convenience wrapper around discoverIsilonExportsForFileServers
   * that fetches the config and passes all file servers.
   * 
   * Used during config creation to discover exports for workflow payload.
   */
  async discoverIsilonExports(configId: string, traceId: string): Promise<Map<string, DiscoveredVolumeData[]>> {
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
        return new Map<string, DiscoveredVolumeData[]>();
      }

      // Delegate to the shared method for all file servers
      return await this.discoverIsilonExportsForFileServers(config, config.fileServers, traceId);
    } catch (error) {
      this.logger.error(`Error discovering Isilon exports for config ${configId}: ${error.message}`);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(`Failed to discover Isilon exports: ${error.message}`);
    }
  }

  /**
   * Discover exports/shares for specific file servers only
   * Used for per-zone refresh from UI
   * 
   * IMPORTANT: If API discovery fails, we throw an error to prevent
   * volumes from being incorrectly disabled due to empty paths.
   * 
   * Returns Map<fileServerId, DiscoveredVolumeData[]>
   * - For NFS: volumePath = directoryPath (both are the export path)
   * - For SMB: volumePath = share name, directoryPath = filesystem path
   */
  async discoverIsilonExportsForFileServers(
    config: ConfigEntity,
    fileServers: FileServerEntity[],
    traceId: string,
  ): Promise<Map<string, DiscoveredVolumeData[]>> {
    const discoveredPathsMap = new Map<string, DiscoveredVolumeData[]>();
    const errors: string[] = [];
    
    this.logger.log(`Discovering Isilon exports for ${fileServers.length} file server(s) (trace: ${traceId})`);

    if (config.serverType !== ServerType.dell) {
      this.logger.warn(`Config ${config.id} is not Dell Isilon, skipping API discovery`);
      return discoveredPathsMap;
    }

    // For each specified file server (zone), fetch exports and shares
    for (const fileServer of fileServers) {
      this.logger.log(`Fetching exports for file server ${fileServer.id} (zone: ${fileServer.fileServerName})`);

      const volumeDataList: DiscoveredVolumeData[] = [];
      let apiError: string | null = null;

      // Fetch NFS exports if protocol includes NFS
      if (fileServer.protocol === Protocol.NFS) {
        try {
          const nfsExports = await this.isilonStorageClient.getNFSExportPaths(fileServer.id);
          this.logger.log(`Found ${nfsExports.length} NFS exports for file server ${fileServer.id}`);

          for (const nfsExport of nfsExports) {
            // For NFS: volumePath and directoryPath are the same (both are the export path)
            volumeDataList.push({
              volumePath: nfsExport.path,
              directoryPath: nfsExport.path,
            });
          }
        } catch (error) {
          apiError = `Failed to fetch NFS exports: ${error.message}`;
          this.logger.error(`Failed to fetch NFS exports for file server ${fileServer.id}: ${error.message}`);
        }
      }

      // Fetch SMB shares if protocol includes SMB
      if (fileServer.protocol === Protocol.SMB) {
        try {
          const smbShares = await this.isilonStorageClient.getSMBShares(fileServer.id);
          this.logger.log(`Found ${smbShares.length} SMB shares for file server ${fileServer.id}`);

          for (const smbShare of smbShares) {
            // For SMB: volumePath = share name, directoryPath = filesystem path
            volumeDataList.push({
              volumePath: smbShare.name,
              directoryPath: smbShare.path,
            });
          }
        } catch (error) {
          apiError = `Failed to fetch SMB shares: ${error.message}`;
          this.logger.error(`Failed to fetch SMB shares for file server ${fileServer.id}: ${error.message}`);
        }
      }

      // If API failed for this file server, collect the error
      // We don't want to continue and disable volumes due to API failure
      if (apiError) {
        errors.push(`Zone ${fileServer.fileServerName || fileServer.id}: ${apiError}`);
        continue; // Skip this file server, don't add empty paths
      }

      discoveredPathsMap.set(fileServer.id, volumeDataList);
      this.logger.log(`Discovered ${volumeDataList.length} paths for file server ${fileServer.id}`);
    }

    // If any API calls failed, throw error to prevent incorrect volume disabling
    if (errors.length > 0) {
      const errorMessage = `Unable to connect to Dell Isilon management server. Please check network connectivity and try again. Details: ${errors.join('; ')}`;
      this.logger.error(`Refresh failed due to API errors: ${errorMessage}`);
      throw new BadRequestException(errorMessage);
    }

    return discoveredPathsMap;
  }

  async refreshConfig(configId: string, traceId: string, fileServerId?: string) {
    try {
      // ==================== Validation ====================
      if (!isUUID(configId)) {
        throw new BadRequestException('Invalid UUID format');
      }
      if (fileServerId && !isUUID(fileServerId)) {
        throw new BadRequestException('Invalid fileServerId format');
      }

      // ==================== Fetch Config ====================
      const config = await this.configEntity.findOne({
        where: { id: configId },
        relations: { fileServers: { workers: true, volumes: true } },
      });

      if (!config) {
        throw new NotFoundException(`Config Not found with config id ${configId}`);
      }

      // ==================== Determine File Servers to Refresh ====================
      // With fileServerId (UI call): refresh only that file server/zone
      // Without fileServerId (creation flow): refresh all file servers
      const fileServersToRefresh = fileServerId
        ? config.fileServers.filter(fs => fs.id === fileServerId) 
        : config.fileServers; 

      if (fileServerId && fileServersToRefresh.length === 0) {
        throw new NotFoundException(`File server ${fileServerId} not found in config ${configId}`);
      }

      // ==================== Server-Type Specific Refresh ====================
      switch (config.serverType) {
        case ServerType.dell:
          return await this.refreshDellIsilon(config, fileServersToRefresh, configId, fileServerId, traceId);

        case ServerType.other:
        default:
          return await this.refreshOtherNAS(config, configId, traceId);
      }
    } catch (error) {
      this.logger.error(`Error refreshing config: ${error.message}`);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(`Failed to refresh config. ${error.message}`);
    }
  }

  /**
   * Refresh Dell Isilon configuration using API-based discovery.
   * This is synchronous - exports are discovered via Isilon REST API and saved before returning.
   * 
   * Why API instead of showmount?
   * - showmount doesn't understand Isilon access zones
   * - showmount returns ALL exports from ALL zones
   * - API allows zone-specific export discovery
   */
  private async refreshDellIsilon(
    config: ConfigEntity,
    fileServersToRefresh: FileServerEntity[],
    configId: string,
    fileServerId: string | undefined,
    traceId: string,
  ) {
    this.logger.log(
      `[Dell Isilon] Refreshing config ${configId}${fileServerId ? ` (zone: ${fileServerId})` : ' (all zones)'}`,
    );

    const fileServerIds = fileServersToRefresh.map((fs) => fs.id);

    // Check refresh eligibility per file server (jobs running, scheduled, etc.)
    for (const fileServer of fileServersToRefresh) {
      const refreshStatus = await this.isRefreshPossible(configId, fileServer.id);
      if (!refreshStatus.isRefreshAvailable) {
        this.logger.warn(`Refresh not available for zone ${fileServer.fileServerName}. Reason: ${refreshStatus.message}`);
        throw new BadRequestException(
          refreshStatus.message || `Refresh not available for zone ${fileServer.fileServerName || fileServer.id}.`,
        );
      }
    }

    // Mark as refreshing
    await this.fileServerEntity.update(
      { id: In(fileServerIds) },
      { isRefreshed: false },
    );

    try {
      // Discover exports via Isilon REST API (zone-aware)
      const discoveredPathsMap = await this.discoverIsilonExportsForFileServers(config, fileServersToRefresh, traceId);

      // Sync volumes (create new, keep existing, mark removed as deleted)
      await this.syncVolumesForFileServers(
        fileServersToRefresh,
        discoveredPathsMap,
        config.createdBy,
        config.updatedBy,
        undefined, // pathsMap not used for Dell
        config.serverType as ServerType,
      );

      // Update scan timestamp
      await this.configEntity.update({ id: configId }, { scannedDate: new Date() });
    } catch (error) {
      // On error, reset isRefreshed to true so user can retry
      await this.fileServerEntity.update(
        { id: In(fileServerIds) },
        { isRefreshed: true },
      );
      throw error;
    }

    const refreshedZones = fileServersToRefresh.map(fs => fs.fileServerName || fs.id);
    return {
      message: fileServerId
        ? `Zone ${refreshedZones[0]} refreshed successfully`
        : `Dell config refreshed successfully (${refreshedZones.length} zone(s))`,
      refreshedFileServers: fileServerIds,
    };
  }

  /**
   * Refresh Other NAS configuration using worker-based showmount discovery.
   * This is asynchronous - starts a workflow and returns workflowId for UI to poll.
   * 
   * Flow:
   * 1. Start ListPathsWorkflow on workers
   * 2. Workers run showmount to discover exports
   * 3. UI polls workflow status
   * 4. On completion, updateResult() saves discovered paths
   */
  private async refreshOtherNAS(
    config: ConfigEntity,
    configId: string,
    traceId: string,
  ) {
    this.logger.log(`[Other NAS] Refreshing config ${configId} via worker showmount`);

    // Check refresh eligibility at config level
    const refreshStatus = await this.isRefreshPossible(configId);
    if (!refreshStatus.isRefreshAvailable) {
      this.logger.warn(`Refresh not available for config ${configId}. Reason: ${refreshStatus.message}`);
      throw new BadRequestException(
        refreshStatus.message || 'Refresh not available for this configuration.',
      );
    }

    // Build payload for worker workflow
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
        if (!payload.workerIds.includes(worker.workerId)) {
          payload.workerIds.push(worker.workerId);
        }
      });
    });

    if (payload.workerIds.length === 0) {
      this.logger.warn(`No workers found for config ${configId}`);
      return { message: 'No workers available for refresh' };
    }

    // Mark as refreshing
    await this.fileServerEntity.update(
      { id: In(config.fileServers.map((it) => it.id)) },
      { isRefreshed: false },
    );

    // Start async workflow
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

    // Background polling to save results when workflow completes
    this.updateResult(workflow.workflowId, configId);

    return { workflowId: workflow.workflowId };
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

  /**
   * Updates volumes after Other NAS workflow (ListPathsWorkflow) completes.
   * Called by updateResult() when polling detects workflow completion.
   * 
   * Flow:
   * 1. Parse workflow results to extract discovered paths per protocol
   * 2. Build discoveredPathsMap (fileServerId -> paths[])
   * 3. Use shared syncVolumesForFileServers to update DB
   * 
   * Note: Dell Isilon does NOT use this method - it uses syncVolumesForFileServers directly.
   */
  async updatePaths(id: string, details: ListPathWorkflowStatus) {
    try {
      // ==================== Parse Workflow Results ====================
      const pathsMap: PathsMap = {
        NFS: { workers: 0, paths: [] },
        SMB: { workers: 0, paths: [] },
      };

      details.completed.forEach((workflow) => {
        pathsMap[workflow.protocolType].workers++;
        workflow.paths.forEach((path) => {
          if (!pathsMap[workflow.protocolType].paths.includes(path)) {
            pathsMap[workflow.protocolType].paths.push(path);
          }
        });
      });

      // ==================== Fetch Config with File Servers ====================
      const config = await this.configEntity.findOne({
        where: { id },
        relations: {
          fileServers: {
            volumes: true,
          },
        },
      });

      if (!config) {
        this.logger.warn(`Config ${id} not found in updatePaths`);
        return;
      }

      // ==================== Build Discovered Paths Map ====================
      // Map each file server to its discovered paths based on protocol
      const discoveredPathsMap = new Map<string, string[]>();
      for (const fileServer of config.fileServers) {
        discoveredPathsMap.set(fileServer.id, pathsMap[fileServer.protocol].paths);
      }

      // ==================== Sync Volumes ====================
      await this.syncVolumesForFileServers(
        config.fileServers,
        discoveredPathsMap,
        config.createdBy,
        config.updatedBy,
        pathsMap, // Pass pathsMap for reachableCount (worker count)
        config.serverType as ServerType,
      );

      // ==================== Update Scan Timestamp ====================
      await this.configEntity.update({ id }, { scannedDate: new Date() });
    } catch (error) {
      this.logger.error(`Error in updatePaths: ${error.message}`);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(`Failed to update paths: ${error.message}`);
    }
  }

  /**
   * Shared method to synchronize volumes for file servers
   * Used by both Dell (API discovery) and Other NAS (workflow discovery)
   * 
   * Steps:
   * 1. Re-enable existing volumes if path still exists on NAS
   * 2. Create new volumes for paths that don't exist in DB
   * 3. Disable volumes that no longer exist on NAS
   * 4. Mark file servers as refreshed
   * 5. Deactivate job configs with invalid/disabled volumes
   */
  private async syncVolumesForFileServers(
    fileServers: FileServerEntity[],
    discoveredPathsMap: Map<string, string[] | DiscoveredVolumeData[]>,
    createdBy: string,
    updatedBy?: string,
    pathsMap?: PathsMap, // for reachableCount (Other NAS - from workflow)
    serverType?: ServerType, // to determine reachableCount logic and directoryPath handling
  ): Promise<void> {
    const fileServersIds = fileServers.map((fs) => fs.id);

    for (const fileServer of fileServers) {
      const discoveredData = discoveredPathsMap.get(fileServer.id) || [];
      
      // Determine reachableCount based on server type
      let reachableCount: number;
      if (serverType === ServerType.dell) {
        // Dell: use worker count per file server (zone)
        reachableCount = fileServer.workers?.length ?? 0;
      } else {
        // Other NAS: use worker count from pathsMap (workflow result)
        reachableCount = pathsMap?.[fileServer.protocol]?.workers ?? 0;
      }

      // Normalize discovered data to DiscoveredVolumeData[]
      // For Dell: already in DiscoveredVolumeData format
      // For Other NAS: convert string[] to DiscoveredVolumeData[] (volumePath = directoryPath)
      const volumeDataList: DiscoveredVolumeData[] = discoveredData.map((item) => {
        if (typeof item === 'string') {
          // Other NAS: volumePath = directoryPath (no separate directory path)
          return { volumePath: item, directoryPath: item };
        }
        return item;
      });

      const discoveredPaths = volumeDataList.map((v) => v.volumePath);
      
      // Build a map of volumePath -> directoryPath for quick lookup
      const directoryPathMap = new Map<string, string>();
      for (const vd of volumeDataList) {
        directoryPathMap.set(vd.volumePath, vd.directoryPath);
      }

      // 1. Re-enable existing volumes if path still exists on NAS
      // Also update directoryPath for Dell
      if (discoveredPaths.length > 0) {
        // For each discovered path, update with correct directoryPath
        for (const vd of volumeDataList) {
          await this.volumes.update(
            {
              fileServerId: fileServer.id,
              volumePath: vd.volumePath,
            },
            {
              reachableCount: reachableCount,
              isValid: true,
              isDisabled: false,
              directoryPath: vd.directoryPath,
            },
          );
        }
      }

      // 2. Create new volumes only for paths that don't exist in DB
      const existingPaths = new Set(
        fileServer.volumes?.map((vol) => vol.volumePath) || [],
      );
      const newVolumes: VolumeEntity[] = [];
      for (const vd of volumeDataList) {
        if (!existingPaths.has(vd.volumePath)) {
          newVolumes.push(
            this.volumes.create({
              fileServerId: fileServer.id,
              volumePath: vd.volumePath,
              directoryPath: vd.directoryPath,
              isValid: true,
              isDisabled: false,
              reachableCount: reachableCount,
              createdBy: updatedBy ?? createdBy,
            }),
          );
        }
      }
      if (newVolumes.length > 0) {
        await this.volumes.save(newVolumes);
        this.logger.log(`Created ${newVolumes.length} new volumes for file server ${fileServer.id}`);
      }

      // 3. Disable volumes that no longer exist on the NAS
      const validPaths = new Set(discoveredPaths);
      const pathsToDisable = (fileServer.volumes || [])
        .filter((vol) => !validPaths.has(vol.volumePath))
        .map((vol) => vol.volumePath);
      if (pathsToDisable.length > 0) {
        await this.volumes.update(
          { fileServerId: fileServer.id, volumePath: In(pathsToDisable) },
          { isDisabled: true },
        );
        this.logger.log(`Disabled ${pathsToDisable.length} volumes for file server ${fileServer.id}`);
      }

      // 4. Mark file server as refreshed
      await this.fileServerEntity.update(
        { id: fileServer.id },
        { isRefreshed: true },
      );
    }

    // 5. Deactivate job configs with invalid/disabled volumes
    const volumeIds = await this.volumes
      .createQueryBuilder('volume')
      .select('volume.id')
      .where('volume.file_server_id IN (:...fileServersIds)', {
        fileServersIds: fileServersIds,
      })
      .andWhere('(volume.is_valid = :isValid OR volume.is_disabled = :isDisabled)', {
        isValid: false,
        isDisabled: true,
      })
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
  }

  async isRefreshPossible(configId: string, fileServerId?: string): Promise<{ isRefreshAvailable: boolean; message?: string }> {
    try {
      let volumeIds: string[] = [];

      if (fileServerId) {
        // Per file server check (Dell per-zone refresh)
        const fileServer = await this.fileServerEntity.findOne({
          where: { id: fileServerId, configId: configId },
          relations: ['volumes'],
        });

        if (!fileServer) {
          this.logger.warn(`File server ${fileServerId} not found in config ${configId}`);
          return { isRefreshAvailable: false, message: 'File server not found' };
        }

        volumeIds = fileServer.volumes?.map((vol) => vol.id) || [];
        
        if (volumeIds.length === 0) {
          this.logger.log(`No volumes found for file server ${fileServerId}, refresh is possible`);
          return { isRefreshAvailable: true };
        }
      } else {
        // Config-level check (existing behavior)
        const config = await this.configEntity.findOne({
          where: { id: configId },
          relations: { fileServers: { volumes: true } },
        });

        if (!config) {
          return { isRefreshAvailable: false, message: 'Config not found' };
        }

        volumeIds = config.fileServers.flatMap((fs) =>
          fs.volumes?.map((vol) => vol.id) || [],
        );
        
        if (volumeIds.length === 0) {
          this.logger.warn(`No valid volumes found for config ID ${configId}.`);
          return { isRefreshAvailable: true }; // No volumes means no jobs, so refresh is possible
        }
      }

      const contextLabel = fileServerId ? `file server ${fileServerId}` : `configuration ${configId}`;

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
        const logMessage = `Refresh is not possible for ${contextLabel} as there are jobs with SCHEDULING status`;
        this.logger.warn(logMessage);
        return { isRefreshAvailable: false, message: userMessage };
      }

      // check if futureScheduleAt is not null for any job config, if yes then return false
      if (jobConfigs.some((jc) => !!jc.futureScheduleAt)) {
        const userMessage = `Jobs are scheduled for future execution. Please cancel or reschedule these jobs before refreshing.`;
        const logMessage = `Refresh is not possible for ${contextLabel} as there are jobs with futureScheduleAt set`;
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
        const logMessage = `Refresh is not possible for ${contextLabel} as there are currently running jobs`;
        this.logger.warn(logMessage);
        return { isRefreshAvailable: false, message: userMessage };
      }

      this.logger.log(`Refresh is possible for ${contextLabel}`);
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
