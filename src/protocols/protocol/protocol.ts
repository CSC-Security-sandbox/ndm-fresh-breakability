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

    protected async executeCommand(
        traceId: string,
        protocolType: string,
        payload: ProtocolPayload,
        commandPattern: string,
        commandDescription: string,
      ): Promise<any> {
      console.log('traceId----->', traceId, 'protocolType----->', protocolType, 'payload----->', payload, 'commandPattern----->', commandPattern, 'commandDescription----->', commandDescription);  
        const response = {
          traceId: traceId,
          status: 'success',
          protocolType: protocolType,
          hostname: payload.hostname,
          workerId: this.workerId,
          message: `[${protocolType}] [${commandDescription}] Successful. Hostname: ${payload?.hostname} Worker: ${this.workerId}`,
        };
      
        const command = commandPattern
          ?.replace('${hostname}', payload?.hostname)
          ?.replace('${USERNAME}', payload?.username)
          ?.replace('${PASSWORD}', payload?.password)
          ?.replace('${path}', payload?.path)
          ?.replace('${jobRunId}', payload?.jobRunId)
          ?.replace('${baseMountDir}', this.baseMountDir);

          console.log('command-->', command);
      
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
