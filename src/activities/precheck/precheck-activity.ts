import * as ffs from 'fast-folder-size';
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Protocols, ProtocolTypes } from "src/protocols/protocols";
import { PreCheckErrorCodes, PreCheckStatus, ServerCredential, Settings, WorkerTaskPaths } from "src/workflows/pre-check/pre-check.types";
import { PreCheckPathOutput } from "./precheck-activity.type";

const fastFolderSize = ffs as unknown as (path: string, callback: (err: Error | null, bytes: number | null) => void) => void;
const fs = require('fs').promises;

@Injectable()
export class PrecheckActivity{
    readonly workerId: string; 
    readonly baseWorkingPath: string
    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        private readonly logger: Logger,
      ) {
        this.workerId = this.configService.get('worker.workerId');
        this.baseWorkingPath = this.configService.get('worker.baseWorkingPath')
      }
      
      async preCheckPath(settings:Settings, serverCredentials: ServerCredential, serverPaths:WorkerTaskPaths, traceId): Promise<PreCheckPathOutput>{
        const PreCheckPathOutput: PreCheckPathOutput = {
          pathId: serverPaths.pathId,
          status: PreCheckStatus.SUCCESS,
          errorCode: undefined,
          workerId: this.workerId
        }

        this.logger.log(`Started Prechecking path ${serverPaths.pathName} on server ${serverCredentials.host}`);
        const protocol = Protocols.getProtocol(ProtocolTypes[serverCredentials.protocol]);
        const protocolPayload = {
          hostname: serverCredentials.host,
          username: serverCredentials.userName,
          password: serverCredentials.password,
          protocolVersion: serverCredentials.protocolVersion,
          mountBasePath: this.baseWorkingPath,
          jobRunId: traceId,
          pathId: serverPaths.pathId,
          path: serverPaths.pathName
        }

        this.logger.warn(protocolPayload)

        try {
          await protocol.validateConnection(traceId, protocolPayload);
          await protocol.mountPath(traceId, protocolPayload);
          
        }catch(error){
          this.logger.error(`Error mounting path ${serverPaths.pathName} on server ${serverCredentials.host}`);
          PreCheckPathOutput.status = PreCheckStatus.FAILED;
          PreCheckPathOutput.errorCode = serverPaths.isSource ? PreCheckErrorCodes.SOURCE_PATH_MOUNT_FAILED : PreCheckErrorCodes.DESTINATION_PATH_MOUNT_FAILED;
          return PreCheckPathOutput;
        }

        try{
          const pathList = await protocol.listPaths(traceId, protocolPayload);
          if(!pathList.includes(serverPaths.pathName)){
            this.logger.error(`Path ${serverPaths.pathName} not found on server ${serverCredentials.host}`);
            PreCheckPathOutput.status = PreCheckStatus.FAILED;
            PreCheckPathOutput.errorCode = serverPaths.isSource ? PreCheckErrorCodes.SOURCE_PATH_NOT_FOUND : PreCheckErrorCodes.DESTINATION_PATH_NOT_FOUND;
            return PreCheckPathOutput;
          }
        }catch(error){
          this.logger.error(`Error listing paths on server ${serverCredentials.host}`);
          PreCheckPathOutput.status = PreCheckStatus.FAILED;
          PreCheckPathOutput.errorCode = serverPaths.isSource ? PreCheckErrorCodes.SOURCE_PATH_NOT_FOUND : PreCheckErrorCodes.SOURCE_PATH_NOT_FOUND;
          return PreCheckPathOutput;
        }

        if(settings.preserveAccessTime || !serverPaths.isSource) {
            try{
            const testFile = `${this.baseWorkingPath}/${traceId}/${serverPaths.pathId}/test-${traceId}-${this.workerId}.txt`;

            const fileHandle = await fs.open(testFile, 'w');
            await fileHandle.close();
            this.logger.debug(`Created test file ${testFile} on server ${serverCredentials.host}`);

            const data = await fs.readFile(testFile, 'utf8');
            this.logger.debug(`Read test file ${testFile} on server ${serverCredentials.host}`);

            await fs.unlink(testFile);
            this.logger.debug(`Deleted test file ${testFile} on server ${serverCredentials.host}`);
          } catch (error) {
            if (error.code === 'ENOSPC') {
              this.logger.error(`No space left on device on server ${serverCredentials.host}`);
              PreCheckPathOutput.status = PreCheckStatus.FAILED;
              PreCheckPathOutput.errorCode = serverPaths.isSource ?
                PreCheckErrorCodes.NO_SPACE_LEFT_ON_SOURCE_PATH :
                PreCheckErrorCodes.NO_SPACE_LEFT_ON_DESTINATION_PATH;
            } else {
              this.logger.error(`Error creating test file on server ${serverCredentials.host}: ${error.message}`);
              PreCheckPathOutput.status = PreCheckStatus.FAILED;
              PreCheckPathOutput.errorCode = serverPaths.isSource ?
                PreCheckErrorCodes.SOURCE_PATH_WRITE_PERMISSION_FAILED :
                PreCheckErrorCodes.DESTINATION_PATH_WRITE_PERMISSION_FAILED;
            }
            return PreCheckPathOutput;
          }
        }

        if (serverPaths.isSource) {
          const mountPath = `${this.baseWorkingPath}/${traceId}/${serverPaths?.pathId}`;
          const protocolPayload = {
            protocolVersion: serverCredentials.protocolVersion,
            mountBasePath: this.baseWorkingPath,
            jobRunId: traceId,
            pathId: serverPaths.pathId,
            path: mountPath
          }
          try {
            const totalSizeInBytes = await protocol.getTotalUsedMemory(traceId, protocolPayload);
            this.logger.log(`SourceDataSize : ${totalSizeInBytes} bytes`);
            PreCheckPathOutput.sourceDataSize = totalSizeInBytes;
          } catch (error) {
            this.logger.error(`Error while calculating source data size on server ${serverCredentials.host} : ${error.message}`);
          }
        }

        if (!serverPaths.isSource) {
          const mountPath = `${this.baseWorkingPath}/${traceId}/${serverPaths?.pathId}`;

          const protocolPayload = {
            protocolVersion: serverCredentials.protocolVersion,
            mountBasePath: this.baseWorkingPath,
            jobRunId: traceId,
            pathId: serverPaths.pathId,
            path: mountPath
          }

          try {
            const availableBytes = await protocol.getAvailableDiskSpace(traceId, protocolPayload);
            this.logger.log(`Available space: ${availableBytes.size} bytes`);
            PreCheckPathOutput.destinationAvailableSpace = availableBytes.size;
          } catch (error) {
            this.logger.error(`Error while calculating destination available space on server ${serverCredentials.host} : ${error.message}`);
          }
        }

        try{
          await protocol.unmountPath(traceId, protocolPayload);
          this.logger.log(`Unmounted path ${serverPaths.pathName} on server ${serverCredentials.host}`);
        }catch(error){
         this.logger.error(`Error unmounting path ${serverPaths.pathName} on server ${serverCredentials.host}`);
        }

        
        return PreCheckPathOutput;
      }
}