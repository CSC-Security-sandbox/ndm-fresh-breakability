import {
  ChildWorkflowCancellationType,
  ParentClosePolicy,
  executeChild,
} from '@temporalio/workflow';
import { ValidateWorkerConnectionWorkflow } from '../validate-connection/validate-worker-connection.workflow';
import { WorkFlows } from 'src/work-manager/work-manager.types';
import { PreCheckMountAndWritePermissionValidation } from './pre-check-mount-validation-workflow';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}

export const PreCheckValidationWorkflow = async ({
  traceId,
  payload,
  options,
}) => {
  log(
    traceId,
    'Starting PreCheckValidationWorkflow with payload ' +
    JSON.stringify(payload),
  );
  const result = new Map();
  let sourcePathEntry = undefined
  const [{ sourceServerCredentials, sourcePaths }] = payload;
  console.log('sourceServerCredentials', sourceServerCredentials);
  console.log('sourcePaths', sourcePaths);
  if (!sourceServerCredentials || !sourcePaths) {
    throw new Error('Invalid payload');
  }
  for (const sourcePath of sourcePaths) {
    for (const worker of sourcePath.commonWorkers) {
      sourcePathEntry = result.get(sourcePath.pathId);
      if (!sourcePathEntry) {
        sourcePathEntry =
        {
          sourcePathId: sourcePath.pathId,
          status: '',
          destination: []
        }
      }
      const sourceValidation = await executeChild(
        ValidateWorkerConnectionWorkflow,
        {
          args: [
            {
              traceId,
              fileServer: {
                hostname: sourceServerCredentials.host,
                protocols: [
                  {
                    type: sourceServerCredentials.protocol,
                    password: sourceServerCredentials.password,
                    userName: sourceServerCredentials.userName,
                  },
                ],
              },
              feature: { enablePreListPath: false, enableVersionFetch: false },
              ...options,
            },
          ],
          workflowId: `${WorkFlows.VALIDATE_CONNECTION}-${traceId}-${worker.workerId}-source`,
          taskQueue: `${worker.workerId}-TaskQueue`,
          cancellationType:
            ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
          parentClosePolicy: ParentClosePolicy.TERMINATE,
        },
      );
      log(traceId, `Source validation completed for ${sourcePath.pathId}`);
      log(
        traceId,
        `Source validation result: ${JSON.stringify(sourceValidation)}`,
      );
      if (sourceValidation.status === 'error') {
        sourcePathEntry.status = 'failed';
        sourcePathEntry.errors = ['SOURCE_SERVER_CONNECTION_FAILED'];
        result.set(sourcePath.pathId, sourcePathEntry);
      }else{
        sourcePathEntry.status = 'success';
        result.set(sourcePath.pathId, sourcePathEntry);
      }
    }

    log(traceId, `Source validation successful for ${sourcePath.pathId}`);
    for (const destination of sourcePath.destinations) {
      for (const worker of sourcePath.commonWorkers) {
        const destinationValidation = await executeChild(
          ValidateWorkerConnectionWorkflow,
          {
            args: [
              {
                traceId,
                fileServer: {
                  hostname: destination.destinationServerCredentials.host,
                  protocols: [
                    {
                      type: destination.destinationServerCredentials.protocol,
                      password:
                        destination.destinationServerCredentials.password,
                      userName:
                        destination.destinationServerCredentials.userName,
                    },
                  ],
                },
                feature: {
                  enablePreListPath: false,
                  enableVersionFetch: false,
                },
                ...options,
              },
            ],
            workflowId: `${WorkFlows.VALIDATE_CONNECTION}-${traceId}-${worker.workerId}-destination`,
            taskQueue: `${worker.workerId}-TaskQueue`,
            cancellationType:
              ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
            parentClosePolicy: ParentClosePolicy.TERMINATE,
          },
        );
        log(
          traceId,
          `Destination validation completed for ${destination.pathId}`,
        );
        log(
          traceId,
          `Destination validation result: ${JSON.stringify(destinationValidation)}`,
        );
        if (destinationValidation.status === 'error') {
          sourcePathEntry.status = 'failed';
          sourcePathEntry.destination.push({
            destinationPathId: destination.destinationPathId,
            status: 'failed',
            errors: ['DESTINATION_SERVER_CONNECTION_FAILED'],
          });
          result.set(sourcePath.pathId, sourcePathEntry);
        }else{
          sourcePathEntry.destination.push({
            destinationPathId: destination.destinationPathId,
            status: 'success',
          });
          result.set(sourcePath.pathId, sourcePathEntry);
        }
        log(
          traceId,
          `Destination validation successful for ${destination.destinationPathId}`,
        );
      }
    }
    //check mount and write permission
    for (const worker of sourcePath.commonWorkers) {
    const sourceMountAndPermissionCheck = await executeChild(PreCheckMountAndWritePermissionValidation, {
      args: [
        {
          traceId,
          fileServer: {
            hostname: sourceServerCredentials.host,
            protocols: 
              {
                type: sourceServerCredentials.protocol,
                password: sourceServerCredentials.password,
                userName: sourceServerCredentials.userName,
              },
            pathId: sourcePath.pathId,
            workingDirectory: sourcePath?.workingDirectory,
            workingDirectoryPathId: sourcePath?.workingDirectoryPathId,
            mountBasePath: sourcePath.mountBasePath,
            exportPathName: sourcePath.exportPathName,
            workingDirectoryExportPathName: sourcePath?.workingDirectoryExportPathName,
            type:'SOURCE'
          },
          feature: { checkWritePermission: sourcePath.preserveAccessTime},
        },
      ],
      workflowId: `${WorkFlows.PRECHECK}-${traceId}-${worker.workerId}-source-write-permission`,
      taskQueue: `${worker.workerId}-TaskQueue`,
      cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
      parentClosePolicy: ParentClosePolicy.TERMINATE,
    });
    log(traceId, `Source mount and write permission check completed for ${sourcePath.pathId}`);
    log(traceId, `Source mount and write permission check result: ${JSON.stringify(sourceMountAndPermissionCheck)}`);
    if (sourceMountAndPermissionCheck.status === 'error') {
      sourcePathEntry.status = sourceMountAndPermissionCheck.status;
      sourcePathEntry.errors = sourceMountAndPermissionCheck.errors;
      result.set(sourcePath.pathId, sourcePathEntry);
    }else{
      sourcePathEntry.status = 'success';
      result.set(sourcePath.pathId, sourcePathEntry);
    }
  }
  //check destination mount and write permission
    for (const destination of sourcePath.destinations) {
      for (const worker of sourcePath.commonWorkers) {
      const destinationMountAndPermissionCheck = await executeChild(PreCheckMountAndWritePermissionValidation, {
        args: [
          {
            traceId,
            fileServer: {
              hostname: destination.destinationServerCredentials.host,
              protocols: 
                {
                  type: destination.destinationServerCredentials.protocol,
                  password: destination.destinationServerCredentials.password,
                  userName: destination.destinationServerCredentials.userName,
                },
              pathId: destination.destinationPathId,
              workingDirectory: destination.destinationServerCredentials?.workingDirectory,
              workingDirectoryPathId: destination.destinationServerCredentials?.workingDirectoryPathId,
              mountBasePath: destination.destinationServerCredentials.mountBasePath,
              exportPathName: destination.destinationServerCredentials.exportPathName,
              workingDirectoryExportPathName: destination.destinationServerCredentials?.workingDirectoryExportPathName,
              type:'DESTINATION'
            },
            feature: { checkWritePermission: false},
          },
        ],
        workflowId: `${WorkFlows.PRECHECK}-${traceId}-${worker.workerId}-destination-write-permission`,
        taskQueue: `${worker.workerId}-TaskQueue`,
        cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: ParentClosePolicy.TERMINATE,
      });
      log(traceId, `Destination mount and write permission check completed for ${destination.destinationPathId}`);
      log(traceId, `Destination mount and write permission check result: ${JSON.stringify(destinationMountAndPermissionCheck)}`);
      if (destinationMountAndPermissionCheck.status === 'failed') {
        sourcePathEntry.destination.push({
          destinationPathId: destination.destinationPathId,
          status: destinationMountAndPermissionCheck.status,
          errors: destinationMountAndPermissionCheck.errors,
        });
        result.set(sourcePath.pathId, sourcePathEntry);
      }else{
        sourcePathEntry.destination.push({
          destinationPathId: destination.destinationPathId,
          status: 'success',
        });
        result.set(sourcePath.pathId, sourcePathEntry);
      }
    }
    }
  }
  const finalResult = Array.from(result.values()).flat();
  return finalResult;
};