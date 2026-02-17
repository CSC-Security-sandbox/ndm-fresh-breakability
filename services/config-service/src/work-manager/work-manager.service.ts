import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { Repository, IsNull, Not, In} from 'typeorm';
import {ServerType} from 'src/constants/enums';
import { WorkerConfiguration } from 'src/constants/types';
import {
  ConfigStatus,
  Platform,
  WorkerStatus,
  WorkFlows,
  WorkFlowType,
} from 'src/constants/enums';
import { WorkerEntity } from 'src/entities/worker.entity';
import { JobRunEntity, JobRunStatus } from 'src/entities/jobrun.entity';
import { ConfigEntity } from 'src/entities/config.entity';
import { WorkflowService } from 'src/workflow/workflow.service';
import { StartWorkFlowPayload } from 'src/workflow/workflow.types';
import { CreateRequestDto } from './dto/validate-connection.dto';
import { ConfigStatusPayloadDTO } from './dto/validate-export-path.dto';
import { SendMailService } from 'src/util/send-email';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import { generateWorkerName } from 'src/util/utils';
import { SuccessEmailType } from 'src/util/send-email.type';
import { readFileSync } from 'fs';
import { request } from 'https';

@Injectable()
export class WorkManagerService {
  readonly logger: LoggerService;
  constructor(
    @InjectRepository(WorkerEntity)
    private readonly workerEntity: Repository<WorkerEntity>,
    private loggerFactory: LoggerFactory,
    private readonly workFlowService: WorkflowService,
    @InjectRepository(JobRunEntity)
    private readonly jobRunRepo: Repository<JobRunEntity>,
    @InjectRepository(ConfigEntity)
    private readonly configRepo: Repository<ConfigEntity>,
    @InjectRepository(WorkerJobRunMap)
    private readonly workerJobRunMap: Repository<WorkerJobRunMap>,
    private readonly configService: ConfigService,
    private readonly sendMailService: SendMailService,
  ) {
    this.logger = this.loggerFactory.create(WorkManagerService.name);
  }

  /**
   * Fetch the Gateway TLS CA certificate from Kubernetes secret using in-cluster API
   * Returns base64-encoded certificate for external workers to trust self-signed certs
   */
  private async getGatewayCACertificate(): Promise<string | null> {
    try {
      // Get secret name from environment or use default
      const secretName = process.env.ISTIO_GATEWAY_TLS_SECRET || 'datamigrator-istio-tls';
      const namespace = process.env.ISTIO_NAMESPACE || 'istio-system';
      
      this.logger.debug(`Fetching Gateway TLS certificate from secret: ${secretName} in namespace: ${namespace}`);
      
      // Read service account token and CA cert for in-cluster authentication
      const token = readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
      const ca = readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt', 'utf8');
      
      // Call Kubernetes API to get the secret
      const certificate = await this.fetchSecretFromK8sAPI(secretName, namespace, token, ca);
      
      if (!certificate) {
        this.logger.warn(`No certificate data found in secret ${secretName}`);
        return null;
      }
      
      this.logger.debug(`Successfully fetched Gateway TLS certificate (${certificate.length} bytes)`);
      return certificate;
    } catch (error) {
      this.logger.error(`Failed to fetch Gateway CA certificate: ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Fetch secret from Kubernetes API using in-cluster service account
   */
  private fetchSecretFromK8sAPI(
    secretName: string,
    namespace: string,
    token: string,
    ca: string,
  ): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'kubernetes.default.svc',
        port: 443,
        path: `/api/v1/namespaces/${namespace}/secrets/${secretName}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        ca: ca,
      };

      const req = request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              this.logger.error(`Kubernetes API returned status ${res.statusCode}: ${data}`);
              resolve(null);
              return;
            }

            const secret = JSON.parse(data);
            const tlsCert = secret?.data?.['tls.crt'];
            
            if (!tlsCert) {
              this.logger.error('Secret does not contain tls.crt field');
              resolve(null);
              return;
            }

            resolve(tlsCert);
          } catch (error) {
            this.logger.error(`Error parsing Kubernetes API response: ${error.message}`);
            resolve(null);
          }
        });
      });

      req.on('error', (error) => {
        this.logger.error(`Error calling Kubernetes API: ${error.message}`);
        reject(error);
      });

      req.end();
    });
  }

  async getConfiguration(
    id: string,
    ip: string,
    projectId: string,
    platform: Platform,
    envVariables: Record<string, any>,
    isRebootCall: boolean,
  ): Promise<{ metaConfig: WorkerConfiguration[]; envVariables: Record<string, any> }> {
    try {
      // Debug: Log what we received
      this.logger.debug(`Worker ${id}: Received envVariables keys: ${Object.keys(envVariables || {}).join(', ')}`);
      this.logger.debug(`Worker ${id}: TEMPORAL_TLS_ENABLED = ${envVariables?.TEMPORAL_TLS_ENABLED} (type: ${typeof envVariables?.TEMPORAL_TLS_ENABLED})`);
      
      // Inject Gateway CA certificate for TLS-enabled external workers
      const temporalTlsEnabled = envVariables?.TEMPORAL_TLS_ENABLED === 'true';
      this.logger.debug(`Worker ${id}: temporalTlsEnabled = ${temporalTlsEnabled}`);
      
      if (temporalTlsEnabled) {
        this.logger.log(`Worker ${id}: Inside TLS enabled block`);
        // Only fetch if not already provided
        if (!envVariables.TEMPORAL_TLS_CA_CERT) {
          this.logger.log(`Worker ${id}: TLS enabled, fetching Gateway CA certificate`);
          const caCert = await this.getGatewayCACertificate();
          if (caCert) {
            envVariables.TEMPORAL_TLS_CA_CERT = caCert;
            this.logger.log(`Worker ${id}: Successfully injected Gateway CA certificate`);
          } else {
            this.logger.warn(`Worker ${id}: Failed to fetch Gateway CA certificate - worker may experience TLS validation errors`);
          }
        } else {
          this.logger.debug(`Worker ${id}: CA certificate already present in envVariables`);
        }
      } else {
        this.logger.log(`Worker ${id}: TLS not enabled, skipping certificate injection`);
      }

      const workerMetaConfig = await this.workerEntity.findOne({
        where: { workerId: id },
      });
      if (workerMetaConfig) {
        const jobRunConfig = await this.jobRunRepo.find({
          where: {
            status: In([
              JobRunStatus.Running,
              JobRunStatus.Ready,
              JobRunStatus.Pausing,
              JobRunStatus.Stopping,
              JobRunStatus.Paused,
            ]),
            workerMap: {
              workerId: id,
              metaConfig: Not(IsNull()),
              isActive: true,
            },
          },
          relations: {
            workerMap: true,
          },
          select: {
            workerMap: {
              metaConfig: {},
              workerId: true,
            },
          },
        });
        jobRunConfig.forEach((data) => {
          if (Array.isArray(data.workerMap)) {
            data.workerMap.forEach((wm) => {
              if (wm.metaConfig) {
                this.logger.debug(
                  `JobRunId: ${data.id}, WorkerId: ${wm.workerId}, MetaConfig: ${JSON.stringify(wm.metaConfig)}`,
                );
                workerMetaConfig.metaConfig.push(wm.metaConfig);
              }
            });
          }
        });
        if (isRebootCall) {
          await this.workerEntity.update(
            { workerId: workerMetaConfig.workerId },
            {
              workerName: generateWorkerName(
                workerMetaConfig.workerNumber,
                platform,
              ),
              platform: platform,
              envVariables: envVariables,
              workerVersion: envVariables?.WORKER_VERSION || null,
            },
          );
        }
        return { metaConfig: workerMetaConfig.metaConfig, envVariables };
      }
      this.logger.warn(`project ID : ${projectId}`);

      const newWorker = this.workerEntity.create({
        workerId: id,
        ipAddress: ip,
        metaConfig: this.createWorkerConfiguration(id),
        status: WorkerStatus.Online,
        workerName: id,
        createdBy: id,
        projectId,
        platform: platform,
        envVariables: envVariables,
        workerVersion: envVariables?.WORKER_VERSION || null,
      });
      const result = await this.workerEntity.save(newWorker);

      await this.sendMailService.sendMail({
        successEmailType: SuccessEmailType.WORKER_USAGE,
        projectId,
        workerUsage: { id, ip },
      });
      await this.workerEntity.update(
        { workerId: result.workerId },
        {
          workerName: generateWorkerName(result.workerNumber, platform),
          envVariables: envVariables,
        },
      );

      return { metaConfig: result.metaConfig, envVariables };
    } catch (error) {
      this.logger.error(
        `Error while fetching worker configuration for workerId: ${id}, ${error}`,
      );
      throw new Error('Error while fetching worker configuration');
    }
  }

  createWorkerConfiguration = (workerId: string): WorkerConfiguration[] => [
    {
      configName: WorkFlowType.PARENT_WORKFLOW,
      dynamicTaskQueue: false,
      taskQueueId: null,
      workerId: workerId,
    },
    {
      configName: WorkFlowType.WORKER_SPECIFIC_WORKFLOW,
      dynamicTaskQueue: true,
      taskQueueId: workerId,
      workerId: workerId,
    },
  ];

  async validateConnection(payload: CreateRequestDto, traceId: string) {
    try {
      const startWorkFlowPayload: StartWorkFlowPayload = {
        workflowId: WorkFlows.VALIDATE_CONNECTION + '-' + traceId,
        taskQueue: 'ParentWorkflow-TaskQueue',
        args: [
          {
            traceId: traceId,
            payload: {
              traceId,
              feature: this.configService.get('app.feature'),
              ...payload,
            },
            options: payload.options,
          },
        ],
        ...payload.options,
      };
      const workflow = await this.workFlowService.startWorkflow(
        WorkFlows.VALIDATE_CONNECTION,
        startWorkFlowPayload,
      );
      return { workflowId: workflow.workflowId };
    } catch (error) {
      this.logger.error(`Error in validateConnection: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to start validate connection workflow for traceId: ${traceId}, ${error.message}`,
      );
    }
  }

  async validateWorkingDirectory(data: ConfigStatusPayloadDTO) {
    try {
      this.logger.log(
        `Received validateWorkingDirectory callback: configId=${data.configId}, fileServerId=${data.fileServerId}, status=${data.status}`,
      );
      const config = await this.configRepo.findOne({
          where: { id: data.configId },
          relations: ['fileServers'],
        }); 
      const isOtherNas = config.serverType === ServerType.other;
      // Check if this is a File server status and update only fs status and update the config status accordingly (fileServerId present)
      if (!isOtherNas) {
        // Update file server status and aggregate config status in one save
        this.logger.log(`Per-zone callback: Updating file server ${data.fileServerId} status to ${data.status}`);
        if (config) {
          // Update the specific file server status
          const fileServer = config.fileServers.find(fs => fs.id === data.fileServerId);
          if (fileServer) {
            fileServer.status = data.status;
            fileServer.errorMessage = data.errorMessage;
          }
          // Aggregate config status from all file servers
          const hasDraft = config.fileServers.some(fs => fs.status === ConfigStatus.DRAFT);
          const hasErrored = config.fileServers.some(fs => fs.status === ConfigStatus.ERRORED);
          const allActive = config.fileServers.every(fs => fs.status === ConfigStatus.ACTIVE);

          if (hasDraft) {
            config.status = ConfigStatus.DRAFT;
            config.errorMessage = 'One or more zones have no workers assigned';
          } else if (hasErrored) {
            config.status = ConfigStatus.ERRORED;
            // Use actual error message from the errored file server
            const erroredFs = config.fileServers.find(fs => fs.status === ConfigStatus.ERRORED);
            config.errorMessage = erroredFs?.errorMessage || 'One or more zones failed validation';
          } else if (allActive) {
            config.status = ConfigStatus.ACTIVE;
            config.errorMessage = null;
          } else {
            config.status = ConfigStatus.IN_PROGRESS;
            config.errorMessage = null;
          }
          this.logger.log(
            `Non Other NAS :config ${config.id}: Aggregated status = ${config.status} (${config.fileServers.length} file servers)`,
          );
        }
      } else {
        // Other NAS: Update config status directly
        if (config) {
          config.status = data.status;
          config.errorMessage = data.errorMessage;
          config.fileServers.forEach(fs => {
            fs.status = data.status;
            fs.errorMessage = data.errorMessage;
          });        
        }     
      }
      await this.configRepo.save(config);
    } catch (error) {
      this.logger.error(
        `Error while updating the status of a file server after validating export path and working directory- ${error.message}`,
      );
    }
  }

  async getChildWorkFlowRes(id: string) {
    try {
      if (!id) {
        throw new BadRequestException('Child Workflow ID is required');
      }

      const response = await this.workFlowService.getWorkFlowRes(id);

      if (!response) {
        throw new NotFoundException(`No workflow response found for ID: ${id}`);
      }

      if (response.status === 'TERMINATED' || response.status === 'FAILED' || response.status === 'TIMED_OUT') {
        const errorMessage = `Pre-check with ID ${id} is ${response.status.toLowerCase()}. Please check the workflow logs for more details.`;
        const payload = await this.workFlowService.getWorkFlowPayload(id);
        return {
          ...response,
          workflow: {
            errors: [errorMessage],
            sourcePathId: payload?.[0]?.payload?.preChecks?.[0]?.pathId ?? null,
            destinationPathIds: payload?.[0]?.payload?.preChecks?.[0]?.destinations?.map(d => d?.pathId) ?? null,
          },
        };
      }
      return response;
    } catch (error) {
      this.logger.error(`Error in getChildWorkFlowRes: ${error.message}`);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to retrieve child workflow response for ID: ${id}`,
      );
    }
  }

  async updateWorkerConfigurations(jobRunId: string, workerId: string) {
    if (jobRunId) {
      try {
        const workerConfiguration = {
          configName: WorkFlowType.JOB_SPECIFIC_WORKFLOW,
          dynamicTaskQueue: true,
          taskQueueId: `${jobRunId}`,
          workerId: workerId,
        };

        await this.workerJobRunMap.update(
          { jobRunId: jobRunId, workerId: workerId },
          { metaConfig: workerConfiguration },
        );
      } catch (error) {
        this.logger.error(
          `Error while updating worker configurations for jobRunId: ${jobRunId}`,
          error.stack,
        );
        throw new Error('Error while updating worker configurations');
      }
    } else {
      this.logger.error('JobRunId is required to update worker configurations');
      throw new Error('JobRunId is required to update worker configurations');
    }
  }
}
