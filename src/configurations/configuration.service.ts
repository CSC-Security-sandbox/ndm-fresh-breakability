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
  ProtocolVersionError,
  WorkFlows,
} from 'src/constants/enums';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { FileServerWorkingDirectoryMappingEntity } from 'src/entities/fileserver_workingdirectory_mapping.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { JobStatus, JobType } from 'src/entities/jobconfig.entity';
import { JobRunStatus } from 'src/entities/jobrun.entity';
import { WorkflowService } from 'src/workflow/workflow.service';
import { ConfigDTO } from './dto/config.dto';
import { ValidateExportPathAndWorkingDirectoryDTO } from './dto/validate-export-path-working-directory.dto';
import { FindAllConfigPageDto, FileServerInfo } from './dto/findallconfig.dto';
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
@Injectable()
export class ConfigurationService {
  private logger: LoggerService;
  private timeout: number;
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
    @InjectRepository(ProjectEntity)
    private readonly projectEntity: Repository<ProjectEntity>,
    private loggerFactory: LoggerFactory,
    private readonly workFlowService: WorkflowService,
    private readonly sendMailService: SendMailService,
    private readonly configService: ConfigService,
  ) {
    this.logger = this.loggerFactory.create(ConfigurationService.name);
    this.timeout = this.configService.get<number>(
      'app.worker.healthCheckStatusTimout',
    );
  }

  async getAllFileServers(): Promise<any[]> {
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
        'config.status',
        'workingDirectory.workingDirectory',
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
          fileServers: {
            id: true,
            host: true,
            serverType: true,
            protocol: true,
            userName: true,
            isRefreshed: true,
            createdAt: true,
            createdBy: true,
            protocolVersion: true,
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
      throw new InternalServerErrorException('Failed to fetch configurations');
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
            serverType: true,
            protocol: true,
            userName: true,
            password: true,
            isRefreshed: true,
            protocolVersion: true,
            volumes: {
              id: true,
              volumePath: true,
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
            workers: true,
            volumes: {
              jobConfig: {
                jobRunDetails: true,
              },
            },
          },
          workingDirectory: true,
        },
      });

      if (!config)
        throw new NotFoundException(`Config for id ${id} not found.`);

      if (
        config.errorMessage &&
        config.errorMessage.includes(
          ProtocolVersionError.PROTOCOL_VERSION_ERROR,
        )
      ) {
        if (config.fileServers) {
          config.fileServers = config.fileServers.map((server) => ({
            ...server,
            volumes: [],
          }));
        }
      }

      return config;
    } catch (error) {
      this.logger.error(`Error fetching config by ID: ${error.message}`);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to retrieve configuration for ID: ${id}`,
      );
    }
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
      this.logger.error(`Error fetching cutover details: ${error.message}`);
      throw new InternalServerErrorException(
        'An error occurred while processing the request.',
      );
    }
  }

  async isConfigNameUnique(
    projectId: string,
    configName: string,
  ): Promise<{ isUnique: boolean }> {
    const projectExists = await this.projectEntity.findOne({
      where: { id: projectId },
    });
    if (!projectExists) {
      throw new NotFoundException('Invalid Project ID');
    }

    const existingConfig = await this.configEntity.findOne({
      where: { projectId, configName },
    });

    if (existingConfig) {
      throw new BadRequestException(
        'Config name already exists for this project.',
      );
    }

    return { isUnique: true };
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
              },
            },
          },
        },
        where: {
          id: configId,
          fileServers: {
            volumes: {
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
      throw new InternalServerErrorException('Failed to fetch config details.');
    }
  }

  private extractValidJobConfigs(config: ConfigEntity) {
    try {
      return config.fileServers.flatMap((fileServer) =>
        fileServer.volumes.flatMap((volume) =>
          volume.jobConfig
            .filter(
              (jobConfig) =>
                jobConfig.jobType === JobType.Migrate &&
                jobConfig.status !== JobStatus.InActive &&
                jobConfig.jobRunDetails.some(
                  (jobRun) => jobRun.status === JobRunStatus.Completed,
                ),
            )
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
      throw new InternalServerErrorException(
        'Failed to extract valid job configurations.',
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
        volumeDetails.map((volume) => [
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
        'Failed to retrieve volume details.',
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
      throw new InternalServerErrorException('Failed to construct response.');
    }
  }

  async IsAllUnHealthyWorkers(workers: WorkerEntity[]): Promise<boolean> {
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
  ) {
    this.logger.debug('Config creation started');

    const credentials: Credentials[] = [];
    let allUnHealthy = false;
    try {
      await this.isConfigNameUnique(
        createConfig.projectId,
        createConfig.configName,
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
          });
          return this.fileServerEntity.create({
            host: fileServer.host.trim(),
            serverType: fileServer.serverType,
            workers: workers,
            createdBy: userId,
            protocol: fileServer.protocol,
            protocolVersion: fileServer.protocolVersion,
            userName: fileServer.userName,
            password: fileServer?.password,
            isRefreshed: false,
            volumes: [],
          });
        },
      );
      const workers: WorkerEntity[] = await this.WorkerEntity.find({
        where: { workerId: In(createConfig?.fileServers[0].workers) },
        relations: { stats: true },
      });
      const hasPathName = createConfig?.workingDirectory?.pathName?.length > 0;
      const hasWorkers = createConfig?.fileServers?.some(
        (fs) => fs?.workers?.length > 0,
      );
      const config = this.configEntity.create({
        configName: createConfig.configName,
        configType: createConfig.configType,
        projectId: createConfig.projectId,
        status: hasWorkers ? ConfigStatus.IN_PROGRESS : ConfigStatus.DRAFT,
        fileServers: await Promise.all(fileServerPromises),
        createdBy: userId,
      });

      if (workers?.length > 0 && (await this.IsAllUnHealthyWorkers(workers)))
        allUnHealthy = true;
      if (allUnHealthy) {
        config.status = ConfigStatus.ERRORED;
        config.errorMessage = ConfigErrorMsg.ERRORED;
      }
      const update = await this.configEntity.save(config);
      if (!allUnHealthy) {
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

        const htmlContent = `
            <p>Hello</p>
            <p>Config ${update.configName} has been created successfully</p>
            <p>with below server details:</p>
            ${createConfig.fileServers
              .map(
                (fileServer) => `
                <p>Server Name: ${fileServer.host.trim()}</p>
                <p>Server Type: ${fileServer.serverType}</p>
                <p>Protocol: ${fileServer.protocol}</p>
                <p>Workers: ${workerNames.length > 0 ? workerNames.join(', ') : 'Workers are not associated with the file server'}</p>
            `,
              )
              .join('')}
        `;
        const payload = { body: htmlContent };
        this.logger.log(
          `Sending email for config creation ${update.id} with payload ${JSON.stringify(payload)}`,
        );
        await this.sendMailService.sendMail(payload);
        const workingDirectory =
          this.fileServerWorkingDirectoryMappingEntity.create({
            pathName: createConfig?.workingDirectory?.pathName,
            pathId: createConfig?.workingDirectory?.pathId,
            workingDirectory: createConfig?.workingDirectory?.workingDirectory,
            configId: update.id,
            createdBy: userId,
          });
        await this.fileServerWorkingDirectoryMappingEntity.save(
          workingDirectory,
        );
        this.refreshConfig(update.id, traceId);
      }

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
        'Error Occurred during creating Config',
      );
    }
  }

  async updateConfiguration(
    id: string,
    updateConfig: ConfigDTO,
    userId: string,
    traceId: string,
  ) {
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

    if (!config) throw new NotFoundException(`Config for id ${id} not found.`);

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
    config.status = hasWorkers
      ? hasPathName
        ? ConfigStatus.IN_PROGRESS
        : ConfigStatus.ACTIVE
      : ConfigStatus.DRAFT;
    let workersWithStats: WorkerEntity[];

    try {
      const fileServerPromises = config.fileServers.map(async (fileServer) => {
        const update = updateConfig.fileServers.find(
          (it) => it.id == fileServer.id,
        );
        const workers = Array.isArray(update?.workers)
          ? await this.WorkerEntity.find({
              where: { workerId: In(update.workers) },
            })
          : [];
        workersWithStats = Array.isArray(update?.workers)
          ? await this.WorkerEntity.find({
              where: { workerId: In(update.workers) },
              relations: { stats: true },
            })
          : [];
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
          serverType: fileServer.serverType,
          workers: workers,
          createdBy: fileServer.createdBy,
          protocol: fileServer.protocol,
          protocolVersion: update?.protocolVersion,
          userName: update.userName || fileServer.userName,
          volumes: fileServer.volumes,
          password: update.password,
          updatedBy: userId,
          isRefreshed: false,
        });
      });
      if (
        workersWithStats?.length > 0 &&
        (await this.IsAllUnHealthyWorkers(workersWithStats))
      )
        allUnHealthy = true;

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
      if (allUnHealthy) {
        config.status = ConfigStatus.ERRORED;
        config.errorMessage = ConfigErrorMsg.ERRORED;
      }

      const update = await this.configEntity.save(config);
      if (!allUnHealthy) {
        const htmlContent = `
            <p>Hello</p>
            <p>Config ${update.configName} has been updated successfully</p>
            ${
              removedWorkers?.length > 0
                ? `
                  <p>Below is the list of deassociated workers:</p>
                  ${removedWorkers.map((worker) => `<p>Worker Name: ${worker?.workerName}</p>`).join('')}
              `
                : ''
            }
           `;

        const payload = { body: htmlContent };
        this.logger.log(
          `Sending email for config updation ${update.id} with payload ${JSON.stringify(payload)}`,
        );
        await this.sendMailService.sendMail(payload);
        await this.startValidateWorkingDirectoryWorkflow(
          updateConfig,
          update.id,
          traceId,
        );
        this.refreshConfig(update.id, traceId);
      }
      return update;
    } catch (error) {
      this.logger.error(
        `Error Occurred during updating Config ${error.message} for traceId ${traceId}`,
      );
      if (error instanceof NotFoundException) throw error;
      // Otherwise, throw an InternalServerErrorException for any other errors
      throw new InternalServerErrorException(
        'Error Occurred during updating Config',
      );
    }
  }

  async startValidateWorkingDirectoryWorkflow(
    createConfig: ConfigDTO,
    configId: string,
    traceId: string,
  ) {
    try {
      const listPathPayload: ListPathDTO[] = [];

      createConfig?.fileServers?.forEach((fileServer) => {
        const payload: ListPathDTO = {
          type: fileServer?.protocol,
          protocolVersion: fileServer?.protocolVersion.replace(/^v/, ''),
          host: fileServer?.host.trim(),
          username: fileServer?.userName,
          password: fileServer?.password,
        };
        listPathPayload.push(payload);
      });

      const payload: ValidateExportPathAndWorkingDirectoryDTO = {
        exportPath: createConfig?.workingDirectory?.pathName,
        workingDirectory: createConfig?.workingDirectory?.workingDirectory,
        configId: configId,
        workerIds: [],
        listPathPayload,
        options: new Options(),
      };

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

  async refreshConfig(configId: string, traceId: string) {
    if (!isUUID(configId)) {
      throw new BadRequestException('Invalid UUID format');
    }
    try {
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
      throw new InternalServerErrorException('Failed to refresh config.');
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
      throw new InternalServerErrorException(
        'Failed to update workflow result.',
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
      for (let fileServer of config.fileServers) {
        await this.volumes.update(
          {
            fileServerId: fileServer.id,
            volumePath: In(pathsMap[fileServer.protocol].paths),
          },
          { reachableCount: pathsMap[fileServer.protocol].workers },
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
                createdBy: config.updatedBy ?? config.createdBy,
              }),
            );
        });
        await this.volumes.save(founds);
        await this.fileServerEntity.update(
          { id: fileServer.id },
          { isRefreshed: true },
        );
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
      throw new InternalServerErrorException('Failed to update paths.');
    }
  }
}
