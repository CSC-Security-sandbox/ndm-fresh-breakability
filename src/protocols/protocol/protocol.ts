import { exec } from "child_process";
import { WorkersConfig } from "src/config/app.config";

import { Logger } from "src/logger/logger.service";
import { ProtocolPayload } from "./protocol.type";


export abstract class Protocol {
    protected logger = new  Logger();
    protected workerId = WorkersConfig.get('workerId');
    protected baseMountDir = WorkersConfig.get('baseMountDir');
    protected platform: NodeJS.Platform = WorkersConfig.get('platform');

    abstract listPaths(traceId: string, payload: ProtocolPayload): Promise<string[]>;
    abstract getProtocolVersions(traceId: string, payload: ProtocolPayload): Promise<string[]>;
    abstract validateConnection(traceId: string, payload: ProtocolPayload): Promise<any>;
    abstract mountPath(traceId: string, payload: ProtocolPayload): Promise<any>;  
    abstract unmountPath(traceId: string, payload: ProtocolPayload): Promise<any>;

    public async executeCommand(
        traceId: string,
        protocolType: string,
        payload: ProtocolPayload,
        commandPattern: string,
        commandDescription: string,
      ): Promise<any> {
      const directoryPath= `${payload?.mountBasePath}/${payload?.jobRunId}/${payload?.pathId}`;
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
        console.log(`command : ${command}`)
        this.logger.log(`command: ${command}`)
        return new Promise((resolve, rejects) => {
          exec(command, (error, stdout, stderr) => {
            this.logger.info(
              `[${traceId}] command: ${command}, stdout: ${stdout}, stderr: ${stderr}, error: ${error}`,
            );
      
            if (error) {
              response.message = `[${protocolType}] [${commandDescription}] Failed. Hostname: ${payload.hostname} Worker: ${this.workerId}. Error: ${error}`;
              response.status = 'error';
              return rejects(error);
            }
      
            if (stderr) {
              response.message = `[${protocolType}] [${commandDescription}] Failed. Hostname: ${payload.hostname} Worker: ${this.workerId}. Error: ${stderr}`;
              response.status = 'error';
              return rejects(stderr);
            }
      
            response.message = `${stdout}`;
            resolve(response);
          });
        });
      }    
}
