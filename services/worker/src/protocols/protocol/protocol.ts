import { exec } from "child_process";
import { WorkersConfig } from "src/config/app.config";
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { ProtocolPayload } from "./protocol.type";
import { sanitize } from "src/utils/utilities";

export abstract class Protocol {
    protected readonly logger: LoggerService;
    protected workerId = WorkersConfig.get('workerId');
    protected baseMountDir = WorkersConfig.get('baseMountDir');
    protected platform: NodeJS.Platform = WorkersConfig.get('platform');

    abstract listPaths(traceId: string, payload: ProtocolPayload): Promise<string[]>;
    abstract getProtocolVersions(traceId: string, payload: ProtocolPayload): Promise<string[]>;
    abstract validateConnection(traceId: string, payload: ProtocolPayload): Promise<any>;
    abstract mountPath(traceId: string, payload: ProtocolPayload): Promise<any>;  
    abstract unmountPath(traceId: string, payload: ProtocolPayload): Promise<any>;
    abstract disconnectSession(traceId: string, payload: ProtocolPayload): Promise<any>;
    abstract getTotalUsedMemory(traceId: string, payload: ProtocolPayload): Promise<any>;
    abstract getAvailableDiskSpace(traceId: string, payload: ProtocolPayload): Promise<any>;

    constructor(loggerFactory: LoggerFactory) {
      this.logger = loggerFactory.create(this.constructor.name);
    }

    abstract connect(): void;

    public async executeCommand(
        traceId: string,
        protocolType: string,
        payload: ProtocolPayload,
        commandPattern: string,
        commandDescription: string,
      ): Promise<any> {

      const directoryPath = `${payload?.mountBasePath}/${payload?.jobRunId}/${payload?.pathId}`;
        const response = {
          traceId: traceId,
          status: 'success',
          protocolType: protocolType,
          hostname: payload.hostname,
          workerId: this.workerId,
          message: `[${protocolType}] [${commandDescription}] Successful. Hostname: ${payload?.hostname} Worker: ${this.workerId}`,
        };
        const command = commandPattern
          ?.replaceAll('${HOST}', payload?.hostname)
          ?.replaceAll('${USERNAME}', payload?.username)
          ?.replaceAll('${PASSWORD}', payload?.password)
          ?.replaceAll('${MOUNT_PATH}', payload?.path)
          ?.replaceAll('${DIR_PATH}', directoryPath)
          ?.replaceAll('${PROTOCOL_VERSION}', payload?.protocolVersion)
        const sanitizedCommand = sanitize(command, [payload.password]);
        this.logger.debug(`command: ${sanitizedCommand}`)
        return new Promise((resolve, rejects) => {
          exec(command, (error, stdout, stderr) => {
            const sanitizedStderr = sanitize(stderr, [payload.password]);
            const sanitizedError = sanitize(error?.message, [payload.password]);

            this.logger.log(
              `[${traceId}] command: ${sanitizedCommand}, stdout: ${stdout}, stderr: ${sanitizedStderr}, error: ${sanitizedError}`,
            );
      
            if (error) {
              response.message = `[${protocolType}] [${commandDescription}] Failed. Hostname: ${payload.hostname} Worker: ${this.workerId}. Error: ${sanitizedError}`;
              response.status = 'error';
              return rejects((sanitizedError));
            }
      
            if (stderr) {
              response.message = `[${protocolType}] [${commandDescription}] Failed. Hostname: ${payload.hostname} Worker: ${this.workerId}. Error: ${sanitizedStderr}`;
              response.status = 'error';
              return rejects((sanitizedStderr));
            }
      
            response.message = `${stdout}`;
            resolve(response);
          });
        });
      }
}
