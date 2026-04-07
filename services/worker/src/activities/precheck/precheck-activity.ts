import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Protocols, ProtocolTypes } from "src/protocols/protocols";
import { PreCheckErrorCodes, PreCheckStatus, ServerCredential, Settings, WorkerTaskPaths } from "src/workflows/pre-check/pre-check.types";
import { PreCheckPathOutput } from "./precheck-activity.type";
import { ExportPathSource } from "../list-path/list-path.type";
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

const fs = require('fs').promises;

@Injectable()
export class PrecheckActivity {
  readonly workerId: string;
  readonly baseWorkingPath: string;
  readonly shouldCheckDiskSpace: boolean = false;
  private readonly logger: LoggerService;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly protocols: Protocols
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.baseWorkingPath = this.configService.get('worker.baseWorkingPath');
    this.shouldCheckDiskSpace = this.configService.get<boolean>('worker.checkSpaceForPreCheck');
    this.logger = loggerFactory.create(PrecheckActivity.name);
  }

  async preCheckPath(settings: Settings, serverCredentials: ServerCredential, serverPaths: WorkerTaskPaths, traceId): Promise<PreCheckPathOutput> {
    const preCheckPathOutput: PreCheckPathOutput = {
      pathId: serverPaths.pathId,
      status: PreCheckStatus.SUCCESS,
      errorCodes: [],
      workerId: this.workerId
    };
    this.logger.log(`Started Prechecking path ${serverPaths.pathName} on server ${serverCredentials.host}`);
    const protocol = this.protocols.getProtocol(ProtocolTypes[serverCredentials.protocol]);
    const protocolPayload = {
      hostname: serverCredentials.host,
      username: serverCredentials.userName,
      password: serverCredentials.password,
      protocolVersion: serverCredentials.protocolVersion,
      mountBasePath: this.baseWorkingPath,
      jobRunId: traceId,
      pathId: serverPaths.pathId,
      path: serverPaths.pathName
    };

    let mountSuccess = false;
    try {
      await protocol.validateConnection(traceId, protocolPayload);
      await protocol.mountPath(traceId, protocolPayload, false);
      mountSuccess = true;
    } catch (error) {
      this.logger.error(`Error mounting path ${serverPaths.pathName} on server ${serverCredentials.host}`);
      preCheckPathOutput.errorCodes.push(
        serverPaths.isSource ?
          PreCheckErrorCodes.SOURCE_PATH_MOUNT_FAILED :
          PreCheckErrorCodes.DESTINATION_PATH_MOUNT_FAILED
      );
    }

    if (mountSuccess) {
      const checkPromises = [];

      if(serverCredentials.exportPathSource === ExportPathSource.AUTO_DISCOVER) {
        checkPromises.push(
          protocol.listPaths(traceId, protocolPayload)
            .then(pathList => {
              if (!pathList.includes(serverPaths.pathName)) {
                this.logger.error(`Path ${serverPaths.pathName} not found on server ${serverCredentials.host}`);
                preCheckPathOutput.errorCodes.push(
                  serverPaths.isSource ?
                    PreCheckErrorCodes.SOURCE_PATH_NOT_FOUND :
                    PreCheckErrorCodes.DESTINATION_PATH_NOT_FOUND
                );
              }
            })
            .catch(error => {
              this.logger.error(`Error listing paths on server ${serverCredentials.host}`);
              preCheckPathOutput.errorCodes.push(
                serverPaths.isSource ?
                  PreCheckErrorCodes.SOURCE_PATH_NOT_FOUND :
                  PreCheckErrorCodes.DESTINATION_PATH_NOT_FOUND
              );
            })
          );
      }

      this.logger.log(`Preserve Access Time - ${settings?.preserveAccessTime}`);
      this.logger.log(`Preserve Permissions - ${settings?.preservePermissions}`);
      this.logger.log(`IsDestination - ${!serverPaths?.isSource}`);

      if (settings.preserveAccessTime || !serverPaths.isSource) {
        checkPromises.push(
          (async () => {
            const testFile = `${this.baseWorkingPath}/${traceId}/${serverPaths.pathId}/test-${traceId}-${this.workerId}.txt`;
            try {
              const fileHandle = await fs.open(testFile, 'w');
              await fileHandle.close();
              this.logger.debug(`Created test file ${testFile} on server ${serverCredentials.host}`);

              await fs.readFile(testFile, 'utf8');
              this.logger.debug(`Read test file ${testFile} on server ${serverCredentials.host}`);

              await fs.unlink(testFile);
              this.logger.debug(`Deleted test file ${testFile} on server ${serverCredentials.host}`);
            } catch (error) {
              if (error.code === 'ENOSPC') {
                this.logger.error(`No space left on device on server ${serverCredentials.host}`);
                preCheckPathOutput.errorCodes.push(
                  serverPaths.isSource ?
                    PreCheckErrorCodes.NO_SPACE_LEFT_ON_SOURCE_PATH :
                    PreCheckErrorCodes.NO_SPACE_LEFT_ON_DESTINATION_PATH
                );
              } else {
                this.logger.error(`Error creating test file on server ${serverCredentials.host}: ${error.message}`);
                preCheckPathOutput.errorCodes.push(
                  serverPaths.isSource ?
                    PreCheckErrorCodes.SOURCE_PATH_WRITE_PERMISSION_FAILED :
                    PreCheckErrorCodes.DESTINATION_PATH_WRITE_PERMISSION_FAILED
                );
              }
            }
          })()
        );
      }

      if (serverPaths.isSource) {
        const sizePayload = {
          ...protocolPayload,
          path: `${this.baseWorkingPath}/${traceId}/${serverPaths.pathId}`
        };
        if(this.shouldCheckDiskSpace){
          // Check if the source path is empty
          const isToCalculateSpace = serverPaths?.discoveredSize == null || serverPaths?.discoveredSize < 0;
            if (isToCalculateSpace) {
            checkPromises.push(
              protocol.getTotalUsedMemory(traceId, sizePayload)
                .then(totalSizeInBytes => {
                  this.logger.log(`SourceDataSize : ${totalSizeInBytes} bytes`);
                  preCheckPathOutput.sourceDataSize = totalSizeInBytes;
                })
                .catch(error => {
                  this.logger.error(`Error while calculating source data size on server ${serverCredentials.host} : ${error}`);
                  preCheckPathOutput.errorCodes.push(
                    PreCheckErrorCodes.SOURCE_DATA_SIZE_CALCULATION_FAILED
                  );
                })
              );
          }
          else {
            this.logger.log(`SourceDataSize : ${serverPaths?.discoveredSize} bytes`);
            preCheckPathOutput.sourceDataSize = serverPaths?.discoveredSize || null;
          }
      }
      }

      if (!serverPaths.isSource) {
        const spacePayload = {
          ...protocolPayload,
          path: `${this.baseWorkingPath}/${traceId}/${serverPaths.pathId}`
        };
        if(this.shouldCheckDiskSpace){
          checkPromises.push(
          protocol.getAvailableDiskSpace(traceId, spacePayload)
            .then(availableBytes => {
              this.logger.log(`Available space: ${availableBytes.size} bytes`);
              preCheckPathOutput.destinationAvailableSpace = availableBytes.size;
            })
            .catch(error => {
              this.logger.error(`Error while calculating destination available space on server ${serverCredentials.host} : ${error}`);
              preCheckPathOutput.errorCodes.push(
                PreCheckErrorCodes.DESTINATION_AVAILABLE_SPACE_CALCULATION_FAILED
              );
            })
          );
        }
      }

      await Promise.all(checkPromises);

      try {
        await protocol.unmountPath(traceId, protocolPayload, false);
        this.logger.log(`Unmounted path ${serverPaths.pathName} on server ${serverCredentials.host}`);
      } catch (error) {
        this.logger.error(`Error unmounting path ${serverPaths.pathName} on server ${serverCredentials.host}`);
        preCheckPathOutput.errorCodes.push(
          serverPaths.isSource ?
            PreCheckErrorCodes.SOURCE_PATH_UNMOUNT_FAILED :
            PreCheckErrorCodes.DESTINATION_PATH_UNMOUNT_FAILED
        );
      }
    }

    if (preCheckPathOutput.errorCodes.length > 0) {
      preCheckPathOutput.status = PreCheckStatus.FAILED;
    }

    return preCheckPathOutput;
  }
}