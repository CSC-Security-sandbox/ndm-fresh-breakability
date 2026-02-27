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
import {
  ConfigDTO,
  FetchCertificateRequestDTO,
  FetchCertificateResponseDTO,
  FetchZonesRequestDTO,
  FetchZonesResponseDTO,
} from './dto/config.dto';
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
import {
  ClientConfig,
  StorageClientFactory,
} from 'src/storage-clients/storage-client.factory';

@Injectable()
export class ConfigurationService {
  private logger: LoggerService;
  private timeout: number;
  private escapeHtml: typeof escapeHtml;
  private sanitizeHtml: typeof sanitizeHtml;
  constructor(
    private readonly storageClientFactory: StorageClientFactory,
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
            status: true, // Per-zone status for Dell Isilon
            errorMessage: true, // Per-zone error message for Dell Isilon
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
      if (fileServerId && !isUUID(fileServerId))
        throw new BadRequestException('Invalid fileServerId');

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
            status: true, // Per-zone status
            errorMessage: true, // Per-zone error message
            dnsServer: true,
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
          adServerIp: fileServer.dnsServer, // Expose as adServerIp for UI (SMB edit form)
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
          (fs) => fs.id === fileServerId,
        );
        if (config.fileServers.length === 0) {
          throw new NotFoundException(
            `File server with id ${fileServerId} not found in config ${id}`,
          );
        }
      }

      const isUploadInProgress = await this.isUploadInProgress(
        config.fileServers.map((fs) => fs.id),
      );
      const refreshStatus = await this.isRefreshPossible(config.id);
      const isRefreshAvailable =
        !isUploadInProgress && refreshStatus.isRefreshAvailable;

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

  async getCutoverDetailsByConfigId(configId: string, fileServerId?: string) {
    try {
      if (!isUUID(configId)) {
        throw new BadRequestException('Invalid configId');
      }
      if (fileServerId && !isUUID(fileServerId)) {
        throw new BadRequestException('Invalid fileServerId');
      }
      const config = await this.fetchConfigWithRelations(configId, fileServerId);
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

  private async fetchConfigWithRelations(configId: string, fileServerId?: string) {
    try {
      // Build the where clause - optionally filter by fileServerId for Dell Isilon zones
      const whereClause: any = {
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
      };

      // If fileServerId is provided, filter to only that specific zone
      if (fileServerId) {
        whereClause.fileServers.id = fileServerId;
      }

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
                sourcePathId: true,
                sourceDirectoryPath: true,
                targetPathId: true,
                targetDirectoryPath: true,
                status: true,
              },
            },
          },
        },
        where: whereClause,
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
              sourceDirectoryPath: job.sourceDirectoryPath,
              targetPathId: job.targetPathId,
              targetDirectoryPath: job.targetDirectoryPath,
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
        sourceDirectoryPath: job.sourceDirectoryPath,
        destinationDirectoryPath: job.targetDirectoryPath,
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

      // Build hashmap of hasWorkers per file server (keyed by fileServerName + protocol to handle multiple protocols per zone)
      const hasWorkersMap: Record<string, boolean> = {};
      createConfig.fileServers.forEach((fs) => {
        const key = `${fs.fileServerName}-${fs.protocol}`;
        hasWorkersMap[key] = (fs?.workers?.length ?? 0) > 0;
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
            fileServerName: fileServer.fileServerName,
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
            smartConnectSsip: fileServer.smartConnectSsip, // SSIP for SmartConnect DNS resolution
            smartConnectDnsZone: fileServer.smartConnectDnsZone, // DNS zone from Isilon API
            dnsServer: fileServer.adServerIp, // AD Server IP from UI (SMB)
            status: workers.length > 0
              ? ConfigStatus.IN_PROGRESS
              : ConfigStatus.DRAFT,
          });
        },
      );
      const allWorkerIds = createConfig.fileServers.flatMap((fs) => fs.workers);
      // To fetch all workers associated with all the file servers of the config
      const workers: WorkerEntity[] = await this.WorkerEntity.find({
        where: { workerId: In(allWorkerIds) },
        relations: { stats: true },
      });

      // Config-level status check
      // For Dell: DRAFT if ANY file server has no workers (priority over IN_PROGRESS)
      // For Other NAS: Only one file server, so same logic applies
      const hasDraft = Object.values(hasWorkersMap).some((v) => !v); // TRUE if any file server has no workers
      const hasWorkers = Object.values(hasWorkersMap).some((v) => v); // TRUE if any file server has workers

      // Determine initial config status
      // Priority: DRAFT (if any zone has no workers) > IN_PROGRESS (if any zone has workers)
      const initialConfigStatus = hasDraft
        ? ConfigStatus.DRAFT
        : hasWorkers
          ? ConfigStatus.IN_PROGRESS
          : ConfigStatus.DRAFT;

      let config;    
      if (createConfig.serverType !== ServerType.other) {
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
      } else {
        config = this.configEntity.create({
          configName: sanitizedConfigName,
          configType: createConfig.configType,
          projectId: createConfig.projectId,
          status: initialConfigStatus,
          fileServers: await Promise.all(fileServerPromises),
          createdBy: userId,
          serverType: createConfig.serverType,
        });
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
          const workerIds = fileServer.workers.map((w) => w.workerId);

          const fsWorkers: WorkerEntity[] = await this.WorkerEntity.find({
            where: { workerId: In(workerIds) },
            relations: { stats: true },
          });

          if (
            fsWorkers?.length > 0 &&
            (await this.isAllWorkerUnHealthy(fsWorkers))
          ) {
            fileServer.status = ConfigStatus.ERRORED;
            fileServer.errorMessage = ConfigErrorMsg.ERRORED;
          }
        }
      }
      const update = await this.configEntity.save(config);
      if (allUnHealthy) {
        return update;
      }

      // Start validation workflow - discovery is handled internally based on serverType
      await this.startValidateWorkingDirectoryWorkflow(
        createConfig,
        update.id,
        traceId,
      );

      await this.sendMailService.sendMail({
        successEmailType: SuccessEmailType.CREATE_CONFIGURATION,
        traceId,
        projectId,
        createConfig: {
          configName: update.configName,
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
    projectId?: string,
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

      if (updateConfig.serverType !== ServerType.other) {
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
        ){
          allUnHealthy = true;
        }
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
          smartConnectSsip: update.smartConnectSsip, // SSIP for SmartConnect DNS resolution
          smartConnectDnsZone: update.smartConnectDnsZone, // DNS zone from Isilon API
          dnsServer: update.adServerIp, // AD Server IP from UI (SMB)
          status: workers.length > 0 ? ConfigStatus.IN_PROGRESS : ConfigStatus.DRAFT, // Per-zone status
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
          volumes: [], // Initialize with empty volumes array
          exportPathSource: newFs.exportPathSource,
          zone_id: newFs.zone_id,
          smartConnectSsip: newFs.smartConnectSsip, // SSIP for SmartConnect DNS resolution
          smartConnectDnsZone: newFs.smartConnectDnsZone, // DNS zone from Isilon API
          dnsServer: newFs.adServerIp, // AD Server IP from UI (SMB)
          status: workers.length > 0 ? ConfigStatus.IN_PROGRESS : ConfigStatus.DRAFT, // Per-zone status
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

      // Check worker health at file server level (same as createConfiguration)
      for (const fileServer of config.fileServers) {
        if (fileServer.workers?.length > 0) {
          // Get worker IDs from the already-populated workers relation
          const workerIds = fileServer.workers.map((w) => w.workerId);

          const fsWorkers: WorkerEntity[] = await this.WorkerEntity.find({
            where: { workerId: In(workerIds) },
            relations: { stats: true },
          });

          if (
            fsWorkers?.length > 0 &&
            (await this.isAllWorkerUnHealthy(fsWorkers))
          ) {
            fileServer.status = ConfigStatus.ERRORED;
            fileServer.errorMessage = ConfigErrorMsg.ERRORED;
          }
        }
      }

      // Aggregate per-zone statuses to config-level status (for all server types)
      if (!allUnHealthy) {
        const fileServers = config.fileServers;
        const hasDraft = fileServers.some(
          (fs) => fs.status === ConfigStatus.DRAFT,
        );
        const hasErrored = fileServers.some(
          (fs) => fs.status === ConfigStatus.ERRORED,
        );

        if (hasDraft) {
          config.status = ConfigStatus.DRAFT;
          config.errorMessage = null;
        } else if (hasErrored) {
          config.status = ConfigStatus.ERRORED;
          // Get the actual error message from the errored file server
          const erroredFs = fileServers.find(fs => fs.status === ConfigStatus.ERRORED);
          config.errorMessage = erroredFs?.errorMessage || ConfigErrorMsg.ERRORED;
        } else {
          // All zones have workers and are healthy, set to IN_PROGRESS (workflow will set ACTIVE on success)
          config.status = ConfigStatus.IN_PROGRESS;
          config.errorMessage = null;
        }

        this.logger.debug(
          `Config ${id}: Aggregated status = ${config.status} (hasDraft=${hasDraft}, hasErrored=${hasErrored})`,
        );
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

      // Start validation workflow - discovery is handled internally based on serverType
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

  /**
   * Start validation workflows for each file server.
   *
   * Unified approach for all server types:
   * - For non-Other NAS (e.g., Dell): Discovers exports via API, then starts per-zone workflows
   * - For Other NAS: Skips API discovery, starts workflow (only 1 file server, so loop runs once)
   *
   * Each file server gets its own workflow with fileServerId for per-zone status updates.
   */
  async startValidateWorkingDirectoryWorkflow(
    createConfig: ConfigDTO,
    configId: string,
    traceId: string,
  ) {
    // Validate input parameters
    if (
      !createConfig ||
      !configId ||
      !traceId ||
      !createConfig.fileServers ||
      createConfig.fileServers.length === 0
    ) {
      throw new InternalServerErrorException(
        'Failed to start ValidateWorkingDirectoryWorkflow. Invalid input parameters.',
      );
    }

    try {
      const isOtherNas = createConfig.serverType === ServerType.other;

      // Step 1: Fetch config with file servers from DB to get their IDs
      const config = await this.configEntity.findOne({
        where: { id: configId },
        relations: ['fileServers', 'fileServers.workers'],
      });

      if (!config?.fileServers || config.fileServers.length === 0) {
        this.logger.warn(`No file servers found for config ${configId}`);
        return;
      }

      // Step 2: Build discoveredPathsMap conditionally
      // - For Storage-Aware (Dell, future types): Call API to discover exports
      // - For Other NAS: Skip discovery (map stays null, uses worker-based discovery)
      let discoveredPathsMap: Map<string, DiscoveredVolumeData[]> | null = null;
      let errorMap: Map<string, string> | null = null;

      if (!isOtherNas) {
        this.logger.log(
          `Discovering exports via storage API for config ${configId} (serverType: ${createConfig.serverType})`,
        );
        const result = await this.discoverStorageExportsForFileServers(
          config,
          config.fileServers,
          traceId,
        );
        discoveredPathsMap = result.discoveredPathsMap;
        errorMap = result.errorMap;

        this.logger.log(
          `Discovered exports for ${discoveredPathsMap.size} file server(s), errors for ${errorMap.size} zone(s)`,
        );

        // Update file servers that had API errors with per-zone error messages
        if (errorMap.size > 0) {
          for (const fileServer of config.fileServers) {
            const zoneError = errorMap.get(fileServer.id);
            if (zoneError) {
              fileServer.status = ConfigStatus.ERRORED;
              fileServer.errorMessage = zoneError;
              this.logger.error(
                `Zone ${fileServer.fileServerName || fileServer.id} marked as ERRORED: ${zoneError}`,
              );
            }
          }

          // If ALL file servers failed, mark config as errored too
          if (errorMap.size === config.fileServers.length) {
            config.status = ConfigStatus.ERRORED;
            config.errorMessage = 'Failed to connect to storage management server for all zones';
            await this.configEntity.save(config);
            this.logger.error(`Config ${configId} marked as ERRORED - all zones failed API discovery`);
            return; // Don't start workflows if we can't discover exports for any zone
          }

          // Save the per-zone errors
          await this.configEntity.save(config);
        }
      } else {
        this.logger.debug(
          `Skipping API discovery for Other NAS config ${configId}`,
        );
      }

      // Step 3: Loop through each file server and start a workflow
      // For Other NAS: Only 1 file server, so loop runs once
      // For Dell: Multiple file servers (zones), each gets its own workflow
      for (const fileServer of config.fileServers) {
        // Skip file servers that had API discovery errors (already marked as ERRORED)
        if (errorMap && errorMap.has(fileServer.id)) {
          this.logger.debug(
            `Skipping file server ${fileServer.id} - API discovery failed`,
          );
          continue;
        }

        // Get workers for this file server
        const workerIds = fileServer.workers?.map((w) => w.workerId) || [];

        if (workerIds.length === 0) {
          this.logger.debug(
            `Skipping file server ${fileServer.id} - no workers assigned`,
          );
          continue;
        }

        // Build listPathPayload for this file server
        const listPathPayload: ListPathDTO[] = [{
            type: fileServer.protocol,
            protocolVersion: fileServer.protocolVersion?.replace(/^v/, ''),
            host: fileServer.host?.trim() || '',
            username: fileServer.userName,
            password: fileServer.password,
            exportPathSource: fileServer.exportPathSource,
            smartConnectSsip: fileServer.smartConnectSsip,
            smartConnectDnsZone: fileServer.smartConnectDnsZone,
            dnsServer: fileServer.dnsServer,
        }];

        // Build base payload
        const payload: ValidateExportPathAndWorkingDirectoryDTO = {
          exportPath: config?.workingDirectory?.pathName,
          workingDirectory: config?.workingDirectory?.workingDirectory,
          configId: configId,
          workerIds: workerIds,
          listPathPayload,
          serverType: config.serverType as ServerType,
          options: new Options(),
        };
        
        // Add fileServerId for per-zone status updates 
        (payload as any).fileServerId = fileServer.id;

        // Add discovered paths if available (non-Other NAS only)
        if (discoveredPathsMap?.has(fileServer.id)) {
          const volumeDataList = discoveredPathsMap.get(fileServer.id) || [];
          const discoveredPaths = volumeDataList.map((v) => v.volumePath);
          (payload as any).discoveredPaths = discoveredPaths;

          // Build exportsMap with first path for this file server (storage-aware types)
          if (discoveredPaths.length > 0) {
            const exportsMap: Record<string, string> = {};
            exportsMap[fileServer.host] = discoveredPaths[0];
            (payload as any).exportsMap = exportsMap;
          }

          this.logger.debug(
            `Using ${discoveredPaths.length} discovered paths for file server ${fileServer.id}`,
          );
        }

        // Generate unique workflow ID per file server
        const workflowId = `${WorkFlows.VALIDATE_EXPORT_PATH_AND_WORKING_DIRECTORY}-${traceId}-${fileServer.id}-${Date.now()}`;

        this.logger.debug(
          `Starting workflow for file server ${fileServer.fileServerName || fileServer.id} (fileServerId: ${fileServer.id})`,
        );

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

        this.logger.debug(
          `Started workflow ${workflowId} for file server ${fileServer.id}`,
        );
      }

      this.logger.debug(
        `Completed starting per-file-server workflows for config ${configId}`,
      );
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
   * Discover exports/shares for specific file servers using storage array REST API.
   * Used for per-zone refresh from UI.
   *
   * Works for any storage-aware server type (non-Other NAS).
   * The StorageClientFactory handles creating the appropriate client based on serverType.
   *
   * IMPORTANT: If API discovery fails, we return per-zone errors to allow
   * proper error reporting per file server.
   *
   * Returns { discoveredPathsMap, errorMap }
   * - discoveredPathsMap: Map<fileServerId, DiscoveredVolumeData[]>
   * - errorMap: Map<fileServerId, string> for per-zone errors
   * - For NFS: volumePath = directoryPath (both are the export path)
   * - For SMB: volumePath = share name, directoryPath = filesystem path
   */
  async discoverStorageExportsForFileServers(
    config: ConfigEntity,
    fileServers: FileServerEntity[],
    traceId: string,
  ): Promise<{
    discoveredPathsMap: Map<string, DiscoveredVolumeData[]>;
    errorMap: Map<string, string>;
  }> {
    const discoveredPathsMap = new Map<string, DiscoveredVolumeData[]>();
    const errorMap = new Map<string, string>();

    this.logger.log(
      `Discovering storage exports for ${fileServers.length} file server(s) (serverType: ${config.serverType}, trace: ${traceId})`,
    );

    // Only storage-aware types (non-Other NAS) use API discovery
    if (config.serverType === ServerType.other) {
      this.logger.warn(
        `Config ${config.id} is Other NAS, skipping API discovery`,
      );
      return { discoveredPathsMap, errorMap };
    }

    // For each specified file server (zone), fetch exports and shares
    for (const fileServer of fileServers) {
      this.logger.log(
        `Fetching exports for file server ${fileServer.id} (zone: ${fileServer.fileServerName})`,
      );

      const volumeDataList: DiscoveredVolumeData[] = [];
      let apiError: string | null = null;
      const clientConfig = new ClientConfig(
        config.serverType as ServerType,
        config.hostname,
        config.port,
        config.username,
        config.password,
        config.tlsCaCertificate,
      );
      // Get the appropriate storage client based on server type
      const storageClient = this.storageClientFactory.getClient(clientConfig);

      // Fetch NFS exports if protocol includes NFS
      if (fileServer.protocol === Protocol.NFS) {
        try {
          const nfsExports = await storageClient.getNFSExportPaths(
            fileServer.id,
          );
          this.logger.log(
            `Found ${nfsExports.length} NFS exports for file server ${fileServer.id}`,
          );

          for (const nfsExport of nfsExports) {
            // For NFS: volumePath and directoryPath are the same (both are the export path)
            volumeDataList.push({
              volumePath: nfsExport.path,
              directoryPath: nfsExport.path,
            });
          }
        } catch (error) {
          apiError = error.message;
          this.logger.error(
            `Failed to fetch NFS exports for file server ${fileServer.id}: ${error.message}`,
          );
        }
      }

      // Fetch SMB shares if protocol includes SMB
      if (fileServer.protocol === Protocol.SMB) {
        try {
          const smbShares = await storageClient.getSMBShares(fileServer.id);
          this.logger.log(
            `Found ${smbShares.length} SMB shares for file server ${fileServer.id}`,
          );

          for (const smbShare of smbShares) {
            // For SMB: volumePath = share name, directoryPath = filesystem path
            volumeDataList.push({
              volumePath: smbShare.name,
              directoryPath: smbShare.path,
            });
          }
        } catch (error) {
          apiError = error.message;
          this.logger.error(
            `Failed to fetch SMB shares for file server ${fileServer.id}: ${error.message}`,
          );
        }
      }

      // If API failed for this file server, collect the per-zone error
      // We don't want to continue and disable volumes due to API failure
      if (apiError) {
        errorMap.set(fileServer.id, apiError);
        continue; // Skip this file server, don't add empty paths
      }

      discoveredPathsMap.set(fileServer.id, volumeDataList);
      this.logger.log(
        `Discovered ${volumeDataList.length} paths for file server ${fileServer.id}`,
      );
    }

    // Log errors if any, but don't throw - let caller handle per-zone errors
    if (errorMap.size > 0) {
      this.logger.error(
        `Refresh had ${errorMap.size} zone(s) with API errors`,
      );
    }

    return { discoveredPathsMap, errorMap };
  }

  async refreshConfig(
    configId: string,
    traceId: string,
    fileServerId?: string,
  ) {
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
        throw new NotFoundException(
          `Config Not found with config id ${configId}`,
        );
      }

      // ==================== Determine File Servers to Refresh ====================
      // With fileServerId (UI call): refresh only that file server/zone
      // Without fileServerId (creation flow): refresh all file servers
      const fileServersToRefresh = fileServerId
        ? config.fileServers.filter((fs) => fs.id === fileServerId)
        : config.fileServers;

      if (fileServerId && fileServersToRefresh.length === 0) {
        throw new NotFoundException(
          `File server ${fileServerId} not found in config ${configId}`,
        );
      }

      // ==================== Server-Type Specific Refresh ====================
      // Two categories:
      // 1. Other NAS: Uses worker-based discovery (showmount)
      // 2. Storage-Aware (Dell, future types): Uses API-based discovery via StorageClientFactory
      if (config.serverType === ServerType.other) {
        return await this.refreshOtherNAS(config, configId, traceId);
      } else {
        // All storage-aware types (Dell, future types) use API-based refresh
        return await this.refreshStorageAware(
          config,
          fileServersToRefresh,
          configId,
          fileServerId,
          traceId,
        );
      }
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

  /**
   * Refresh storage-aware configuration using API-based discovery.
   * This is synchronous - exports are discovered via storage REST API and saved before returning.
   *
   * Works for any storage-aware server type (Dell, future types like NetApp, Pure, etc.).
   * The StorageClientFactory handles creating the appropriate client based on serverType.
   *
   * Why API instead of showmount?
   * - showmount doesn't understand storage array concepts (zones, tenants, etc.)
   * - showmount returns ALL exports without filtering
   * - API allows targeted, zone-specific export discovery
   */
  private async refreshStorageAware(
    config: ConfigEntity,
    fileServersToRefresh: FileServerEntity[],
    configId: string,
    fileServerId: string | undefined,
    traceId: string,
  ) {
    this.logger.log(
      `[Storage-Aware: ${config.serverType}] Refreshing config ${configId}${fileServerId ? ` (zone: ${fileServerId})` : ' (all zones)'}`,
    );

    const fileServerIds = fileServersToRefresh.map((fs) => fs.id);

    // Check refresh eligibility per file server (jobs running, scheduled, etc.)
    for (const fileServer of fileServersToRefresh) {
      const refreshStatus = await this.isRefreshPossible(
        configId,
        fileServer.id,
      );
      if (!refreshStatus.isRefreshAvailable) {
        this.logger.warn(
          `Refresh not available for zone ${fileServer.fileServerName}. Reason: ${refreshStatus.message}`,
        );
        throw new BadRequestException(
          refreshStatus.message ||
            `Refresh not available for zone ${fileServer.fileServerName || fileServer.id}.`,
        );
      }
    }
    
    try {
      // Discover exports via storage REST API (zone-aware)
      const { discoveredPathsMap, errorMap } =
        await this.discoverStorageExportsForFileServers(
          config,
          fileServersToRefresh,
          traceId,
        );
      await this.fileServerEntity.update(
        { id: In(fileServerIds) },
        { isRefreshed: false },
      );    
      // Update file servers that had API errors with per-zone error messages
      if (errorMap.size > 0) {
        for (const fileServer of fileServersToRefresh) {
          const zoneError = errorMap.get(fileServer.id);
          if (zoneError) {
            fileServer.status = ConfigStatus.ERRORED;
            fileServer.errorMessage = zoneError;
            fileServer.isRefreshed = true; // Reset so they can retry
          }
        }
        await this.fileServerEntity.save(fileServersToRefresh);

        // If ALL file servers failed, throw error
        if (errorMap.size === fileServersToRefresh.length) {
          throw new BadRequestException(
            'Failed to connect to storage management server for all zones',
          );
        }
      }

      // Filter out file servers that had errors for sync
      const successfulFileServers = fileServersToRefresh.filter(
        (fs) => !errorMap.has(fs.id),
      );

      // Sync volumes (create new, keep existing, mark removed as deleted)
      await this.syncVolumesForFileServers(
        successfulFileServers,
        discoveredPathsMap,
        config.createdBy,
        config.updatedBy,
        undefined, // pathsMap not used for Dell
        config.serverType as ServerType,
      );

      // Update scan timestamp
      await this.configEntity.update(
        { id: configId },
        { scannedDate: new Date() },
      );
    } catch (error) {
      // On error, reset isRefreshed to true so user can retry
      await this.fileServerEntity.update(
        { id: In(fileServerIds) },
        { isRefreshed: true },
      );
      this.logger.error(`[Storage-Aware: ${config.serverType}] ${error.message}`);
      error.message = "An error occurred, please try again";
      throw error;
    }

    const refreshedZones = fileServersToRefresh.map(
      (fs) => fs.fileServerName || fs.id,
    );
    return {
      message: fileServerId
        ? `Zone ${refreshedZones[0]} refreshed successfully`
        : `Config refreshed successfully (${refreshedZones.length} zone(s))`,
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
    this.logger.log(
      `[Other NAS] Refreshing config ${configId} via worker showmount`,
    );

    // Check refresh eligibility at config level
    const refreshStatus = await this.isRefreshPossible(configId);
    if (!refreshStatus.isRefreshAvailable) {
      this.logger.warn(
        `Refresh not available for config ${configId}. Reason: ${refreshStatus.message}`,
      );
      throw new BadRequestException(
        refreshStatus.message ||
          'Refresh not available for this configuration.',
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
        discoveredPathsMap.set(
          fileServer.id,
          pathsMap[fileServer.protocol].paths,
        );
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
      throw new InternalServerErrorException(
        `Failed to update paths: ${error.message}`,
      );
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
      if (serverType !== ServerType.other) {
        // For not otherNas: use worker count per file server (zone)
        reachableCount = fileServer.workers?.length ?? 0;
      } else {
        // Other NAS: use worker count from pathsMap (workflow result)
        reachableCount = pathsMap?.[fileServer.protocol]?.workers ?? 0;
      }

      // Normalize discovered data to DiscoveredVolumeData[]
      // For not otherNas: already in DiscoveredVolumeData format
      // For Other NAS: convert string[] to DiscoveredVolumeData[] (volumePath = directoryPath)
      const volumeDataList: DiscoveredVolumeData[] = discoveredData.map(
        (item) => {
          if (typeof item === 'string') {
            // Other NAS: volumePath = directoryPath (no separate directory path)
            return { volumePath: item, directoryPath: item };
          }
          return item;
        },
      );

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
        this.logger.log(
          `Created ${newVolumes.length} new volumes for file server ${fileServer.id}`,
        );
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
        this.logger.log(
          `Disabled ${pathsToDisable.length} volumes for file server ${fileServer.id}`,
        );
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
      .andWhere(
        '(volume.is_valid = :isValid OR volume.is_disabled = :isDisabled)',
        {
          isValid: false,
          isDisabled: true,
        },
      )
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

  async isRefreshPossible(
    configId: string,
    fileServerId?: string,
  ): Promise<{ isRefreshAvailable: boolean; message?: string }> {
    try {
      let volumeIds: string[] = [];

      if (fileServerId) {
        // Per file server check (Dell per-zone refresh)
        const fileServer = await this.fileServerEntity.findOne({
          where: { id: fileServerId, configId: configId },
          relations: ['volumes'],
        });

        if (!fileServer) {
          this.logger.warn(
            `File server ${fileServerId} not found in config ${configId}`,
          );
          return {
            isRefreshAvailable: false,
            message: 'File server not found',
          };
        }

        volumeIds = fileServer.volumes?.map((vol) => vol.id) || [];

        if (volumeIds.length === 0) {
          this.logger.log(
            `No volumes found for file server ${fileServerId}, refresh is possible`,
          );
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

        volumeIds = config.fileServers.flatMap(
          (fs) => fs.volumes?.map((vol) => vol.id) || [],
        );

        if (volumeIds.length === 0) {
          this.logger.warn(`No valid volumes found for config ID ${configId}.`);
          return { isRefreshAvailable: true }; // No volumes means no jobs, so refresh is possible
        }
      }

      const contextLabel = fileServerId
        ? `file server ${fileServerId}`
        : `configuration ${configId}`;

      /*
        fetch all the job configurations that has any of the volumeIds in
        their sourcePathId or targetPathId and status is ACTIVE
      */
      const jobConfigs = await this.jobConfigRepo.find({
        where: [
          {
            status: JobStatus.Active,
            sourcePathId: In(volumeIds),
          },
          {
            status: JobStatus.Active,
            targetPathId: In(volumeIds),
          },
        ],
      });
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
      this.logger.error(
        `Error checking refresh possibility for config ${configId}: ${error.message}`,
      );
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
  async fetchCertificate(
    request: FetchCertificateRequestDTO,
  ): Promise<FetchCertificateResponseDTO> {
    const clientConfig = new ClientConfig(request.serverType, request.host);
    // Get the appropriate storage client based on server type
    const storageClient = this.storageClientFactory.getClient(clientConfig);
    return await storageClient.fetchCertificate(request.host);
  }

  async fetchZones(
    request: FetchZonesRequestDTO,
  ): Promise<FetchZonesResponseDTO> {
    const clientConfig = new ClientConfig(
      request.serverType,
      request.host,
      request.port,
      request.username,
      request.password,
      request.certificate,
    );
    // Get the appropriate storage client based on server type
    const storageClient = this.storageClientFactory.getClient(clientConfig);
    return await storageClient.fetchZones();
  }

  async validateConnection(
    request: FetchZonesRequestDTO,
  ): Promise<{ isValid: boolean; message: string }> {
    try {
      const clientConfig = new ClientConfig(
        request.serverType,
        request.host,
        request.port,
        request.username,
        request.password,
      );
      // Get the appropriate storage client based on server type
      const storageClient = this.storageClientFactory.getClient(clientConfig);
      const isValid = await storageClient.validateConnection();

      if (isValid) {
        return {
          isValid: true,
          message: 'Connection validated successfully',
        };
      } else {
        return {
          isValid: false,
          message: 'Connection validation failed',
        };
      }
    } catch (error) {
      this.logger.error(`Connection validation error: ${error.message}`);
      return {
        isValid: false,
        message: error.message || 'Connection validation failed',
      };
    }
  }
}
