import { config } from 'dotenv';
import { v4 as uuidv4 } from "uuid";
import { In, Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { BadRequestException, Injectable, Inject } from "@nestjs/common";
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { Options } from "../constants/types";
import { JobRunStatus, JobStatus, JobType, WorkFlows } from "../constants/enums";
import { VolumeEntity } from "../entities/volume.entity";
import { JobConfigPrecheck as JobConfigPreCheck } from "./dto/jobdicoverybulk.dto";
import { WorkflowService } from "../workflow/workflow.service";
import { filterUnhealthyWorkers } from "../utils/worker-filter";
import { StartWorkFlowPayload } from "../workflow/workflow.types";
import { PreCheckCircularDependency, PreChecks, PreCheckWorkflowOPayload, workerWithStatus, } from "./jobconfig.types";
import { MigrationConflictService } from "../migration-conflict/migration-conflict.service";
import { JobRunEntity } from "src/entities/jobrun.entity";
import { InventoryEntity } from "src/entities/inventory.entity";
import { isUUID } from "class-validator";
import { JobConfigEntity } from 'src/entities/jobconfig.entity';

@Injectable()
export class PreCheckService {
    private readonly logger: LoggerService;
    constructor(
        @InjectRepository(VolumeEntity)
        private readonly volumeRepo: Repository<VolumeEntity>,
        private readonly workFlowService: WorkflowService,
        private readonly configService: ConfigService,

        @InjectRepository(JobRunEntity)
        private readonly jobRunRepo: Repository<JobRunEntity>,

        @InjectRepository(InventoryEntity)
        private readonly inventoryRepo: Repository<InventoryEntity>,
        
        @InjectRepository(JobConfigEntity)
        private readonly jobConfigEntity: Repository<JobConfigEntity>,
        
        private readonly migrationConflictService: MigrationConflictService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    ) {
        this.logger = loggerFactory.create(PreCheckService.name);
    }

async checkMigrationConflicts(data: JobConfigPreCheck): Promise<PreCheckCircularDependency[]> {
        return this.migrationConflictService.checkMigrationConflicts(data);
    }
    async initiatePreCheck(data: JobConfigPreCheck): Promise<any> {
        const healthCheckTimeout = parseInt(this.configService.get("app.worker.healthCheckStatusTimout"));
        const traceId: string = uuidv4();

        try {
            const checkMigrationConflicts = await this.checkMigrationConflicts(data);
            if (checkMigrationConflicts && checkMigrationConflicts.length > 0) {
                throw new BadRequestException({
                    status: "error",
                    errors: ["MIGRATION_CONFLICTS_FOUND"],
                    details: checkMigrationConflicts,
                    message: "Migration conflicts detected during precheck.",
                });
            }

            const preCheckPayload = this.createInitialPreCheckPayload(data.preserveAccessTime);
            const pathIds = this.collectAllPathIds(data);
            const pathToWorkerMapping = await this.fetchVolumesWithWorkers(pathIds);

            this.prepareServerCredentials(preCheckPayload, pathToWorkerMapping);

            await this.buildPreChecks(preCheckPayload, data, pathToWorkerMapping, healthCheckTimeout);

            const preCheckWorkPayload = this.prepareWorkflowPayload(preCheckPayload, traceId, data.options);

            const workflow = await this.workFlowService.startWorkflow(WorkFlows.PRECHECK, preCheckWorkPayload);
            return { workflowId: workflow.workflowId };

        } catch (error) {
            this.logger.error(`${traceId}] Failed to perform the pre check: ${error}`);
            if (error instanceof BadRequestException) {
                const response = error.getResponse();
                if (typeof response === 'object' && response !== null && Array.isArray((response as any).errors) && (response as any).errors.includes("MIGRATION_CONFLICTS_FOUND")) {
                    throw error;
                }
            }
            return {
                status: "error",
                erros: ["PRECHECK_FAILED"],
                message: `Failed to perform the pre check: ${error}`,
            };
        }
    }

    private createInitialPreCheckPayload(preserveAccessTime: boolean): PreCheckWorkflowOPayload {
        return {
            preChecks: [],
            settings: { preserveAccessTime: preserveAccessTime },
            serverCredentials: [],
        };
    }

    private collectAllPathIds(data: JobConfigPreCheck): string[] {
        const pathIds: string[] = [];
        data.migrateConfigs.forEach((config) => {
            pathIds.push(config.sourcePathId);
            pathIds.push(...config.destinationPathId);
        });
        return pathIds;
    }

    private async fetchVolumesWithWorkers(pathIds: string[]): Promise<VolumeEntity[]> {
        return this.volumeRepo.find({
            where: { id: In([...pathIds]) },
            relations: { fileServer: { workers: { stats: true }, config: true } },
        });
    }

    private prepareServerCredentials(preCheckPayload: PreCheckWorkflowOPayload, volumes: VolumeEntity[]): void {
        volumes.forEach((volume) => {
            if (!preCheckPayload.serverCredentials.some((server) => server.id === volume.fileServer.id)) {
                preCheckPayload.serverCredentials.push({
                    id: volume.fileServer.id,
                    host: volume.fileServer.host,
                    userName: volume.fileServer.userName,
                    password: volume.fileServer.password,
                    protocol: volume.fileServer.protocol,
                    protocolVersion: volume.fileServer.protocolVersion?.replace(/^v/, ""),
                    serverType: volume.fileServer.config.serverType,
                    exportPathSource: volume.fileServer.exportPathSource,
                });
            }
        });
    }

    private async buildPreChecks(
        preCheckPayload: PreCheckWorkflowOPayload,
        data: JobConfigPreCheck,
        pathToWorkerMapping: VolumeEntity[],
        healthCheckTimeout: number
    ): Promise<void> {
        for(const config of data.migrateConfigs) {
            const sourceVolume = pathToWorkerMapping.find((p) => p.id === config.sourcePathId);
            if (sourceVolume) {
                const discoveredSize = await this.getLatestDiscoveryInventorySize(config.sourcePathId);
                const preChecks: PreChecks = {
                    pathId: config.sourcePathId,
                    serverId: sourceVolume.fileServer.id,
                    pathName: sourceVolume.volumePath,
                    destinations: [],
                    discoveredSize
                };

                const workerWithStatusSet = new Set<workerWithStatus>(
                    sourceVolume.fileServer.workers.map((worker) => ({
                        workerId: worker.workerId,
                        ishealthy: filterUnhealthyWorkers(worker, healthCheckTimeout),
                    }))
                );

                config.destinationPathId.forEach((destinationPathId) => {
                    const destinationVolume = pathToWorkerMapping.find((p) => p.id === destinationPathId);
                    if (destinationVolume) {
                        const workerWithStatus: workerWithStatus[] = [];
                        destinationVolume.fileServer.workers.forEach((worker) => {
                            if ([...workerWithStatusSet].some((w) => w.workerId === worker.workerId)) {
                                workerWithStatus.push({
                                    workerId: worker.workerId,
                                    ishealthy: filterUnhealthyWorkers(worker, healthCheckTimeout),
                                });
                            }
                        });
                        preChecks.destinations.push({
                            pathId: destinationPathId,
                            serverId: destinationVolume.fileServer.id,
                            pathName: destinationVolume.volumePath,
                            workers: workerWithStatus,
                        });
                    }
                });
                preCheckPayload.preChecks.push(preChecks);
            }
        };
    }

    private prepareWorkflowPayload(preCheckPayload: PreCheckWorkflowOPayload, traceId: string, options: any): StartWorkFlowPayload {
        return {
            workflowId: WorkFlows.PRECHECK + "-" + traceId,
            taskQueue: "ParentWorkflow-TaskQueue",
            args: [{
                traceId: traceId,
                payload: preCheckPayload,
                options: new Options(),
            }],
            ...options,
        };
    }

    async getLatestDiscoveryInventorySize(pathId: string): Promise<number> {
        if(!isUUID(pathId)) return -1;
        const latestDiscoveryJobRun = await this.jobRunRepo.createQueryBuilder("jobRun")
            .innerJoinAndSelect("jobRun.jobConfig", "jobConfig")
            .where("jobConfig.source_path_id = :pathId", { pathId })
            .andWhere("jobConfig.job_type = :jobType", { jobType: JobType.DISCOVER })
            .andWhere("jobRun.status = :status", { status: JobRunStatus.Completed })
            .orderBy("jobRun.created_at", "DESC")
            .getOne();
        
        if(!latestDiscoveryJobRun) return -1;
        
        const inventorySize = await this.inventoryRepo.createQueryBuilder("inventory")
            .where("inventory.job_run_id = :jobRunId", { jobRunId: latestDiscoveryJobRun.id })
            .andWhere("inventory.is_directory = :isDirectory", { isDirectory: false })
            .select("SUM(inventory.file_size)", "totalSize")
            .getRawOne();
        if (!inventorySize || !inventorySize.totalSize) return 0;
        return parseInt(inventorySize.totalSize);
    }
}