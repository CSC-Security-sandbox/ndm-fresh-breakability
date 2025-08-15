import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { AuthService } from "../../auth/auth.service";
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

type ValidatePathActivityInput = {
    path: string;
    host: string;
    username: string;
    password: string;
    protocol: ProtocolTypes;
    uploadId: string;
    protocolVersion: string;
    pathId: string;
}

@Injectable()
export class ValidatePathActivity {
    private readonly workerId: string;
    private readonly mountBasePath: string;
    private readonly workerConfigUrl: string;
    private readonly logger: LoggerService;

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly authService: AuthService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
        private readonly protocols: Protocols
    ) {
        this.workerId = this.configService.get('worker.workerId');
        this.mountBasePath = this.configService.get('worker.baseWorkingPath');
        this.workerConfigUrl = this.configService.get('worker.connection.workerConfigUrl');
        this.logger = loggerFactory.create(ValidatePathActivity.name);
    }

    async validatePath({ path, host, username, password, protocol, uploadId, protocolVersion, pathId }: ValidatePathActivityInput): Promise<any> {
        const protocolIns = this.protocols.getProtocol(ProtocolTypes[protocol]);
        const mountBasePath = this.mountBasePath;
        try {
            // mount the path
            this.logger.log(`[${this.workerId}] Mounting path for worker ${this.workerId} with uploadId: ${uploadId}`);
            await protocolIns.mountPath(uploadId, {
                hostname: host,
                username: username,
                password: password,
                protocolVersion,
                mountBasePath,
                jobRunId: uploadId,
                pathId,
                path
            }, false);
            // unmount the path
            this.logger.log(`[${this.workerId}] Unmounting path for worker ${this.workerId} with uploadId: ${uploadId}`);
            await protocolIns.unmountPath(uploadId, {
                hostname: host,
                username: username,
                password: password,
                protocolVersion,
                mountBasePath,
                jobRunId: uploadId,
                pathId,
                path,
            }, false);

            this.logger.log(`[${this.workerId}] Validating paths for worker ${this.workerId}`);
            return {
                traceId: uploadId,
                status: 'success',
                workerId: this.workerId,
                path,
                pathId,
                message: `Paths validated successfully by worker ${this.workerId}`,
            };
        } catch (error) {
            return {
                traceId: uploadId,
                status: 'error',
                workerId: this.workerId,
                path,
                pathId,
                message: `The system was unable to mount or unmount the path ${path}. Please verify that the path you uploaded is correct and try again.`,
            }
        }
    }

    async postValidationResult(uploadId: string, result: any): Promise<void> {
        const url = `${this.workerConfigUrl}/api/v1/paths-upload/${uploadId}`;
        const accessToken = await this.authService.getAccessToken();
        if (!accessToken) throw new Error('Failed to get access token');
        this.logger.log(`[${this.workerId}] Posting validation result to ${url}`);
        try {
            await axios.patch(url, { validationResult: result }, { headers: { Authorization : `Bearer ${accessToken}`}})
            this.logger.log(`[${this.workerId}] Validation result posted successfully for uploadId: ${uploadId}`);
        }
        catch (error) {
            this.logger.error(`[${this.workerId}] Failed to post validation result: ${error.message}`);
            throw new Error(`Failed to post validation result: ${error.message}`);
        }
    }
}