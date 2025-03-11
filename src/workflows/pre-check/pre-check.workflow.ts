import {
  ChildWorkflowCancellationType,
  ParentClosePolicy,
  executeChild,
  proxyActivities,
} from '@temporalio/workflow';
import { ValidateWorkerConnectionWorkflow } from '../validate-connection/validate-worker-connection.workflow';
import { WorkFlows } from 'src/work-manager/work-manager.types';
import { PreCheckMountAndWritePermissionValidation } from './pre-check-mount-validation-workflow';
import { PrecheckActivity } from 'src/activities/precheck/precheck-activity';

async function log(traceId: string, message: string) {
  console.log(`[${traceId}] ${message}`);
}
const {
  checkForCommonWorkersAndExportPath: checkForCommonWorkersAndExportPath,
} = proxyActivities<PrecheckActivity>({ startToCloseTimeout: '3000s' });

export const PreCheckValidationWorkflow = async ({
  traceId,
  payload,
  options,
}) => {
  log(
    traceId,
    'Starting PreCheckValidationWorkflow with payload' +
      JSON.stringify(payload),
  );
  const result = new Map();
  const [{ sourceServerCredentials, sourcePaths }] = payload;
  log(traceId,`sourceServerCredentials', ${JSON.stringify(sourceServerCredentials)}`);
  log(traceId,`sourcePaths', ${JSON.stringify(sourcePaths)}`);
  if (!sourceServerCredentials || !sourcePaths) {
    throw new Error('Invalid payload');
  }
  const inputPayload = payload.flatMap((server) => {
    return server.sourcePaths.map((sourcePath) => ({
      sourcePathId: sourcePath.pathId,
      destinationPathId: sourcePath.destinations.map(
        (destination) => destination.destinationPathId,
      ),
    }));
  });
  /**
   * Checking if the paths are valid and have common workers
   */
  let commonWorkersAndExportPathResponse: any;
  try {
    commonWorkersAndExportPathResponse =
      await checkForCommonWorkersAndExportPath(inputPayload, traceId);
      log(traceId,
      `commonWorkersAndExportPathResponse',
      ${JSON.stringify(commonWorkersAndExportPathResponse)}`)
  } catch (e) {
    console.error('Error in checking common workers and export path', e);
    throw new Error('Error in checking common workers and export path');
  }
  for (const sourcePath of sourcePaths) {
    let sourceMountAndWritePermissionValidationStatus = true;
    let destinationMountAndWritePermissionValidationStatus = true;
    let sourcePathEntry = result.get(sourcePath.pathId) || {
      sourcePathId: sourcePath.pathId,
      status: '',
      destination: [],
    };
    const sourcePathDetails = commonWorkersAndExportPathResponse.find(
      (item: any) => item.sourcePathId === sourcePath.pathId,
    );
    if (sourcePathDetails && sourcePathDetails.status === 'failed') {
      sourcePathEntry.status = 'failed';
      sourcePathEntry.errors.push(sourcePathDetails.error);
      result.set(sourcePath.pathId, sourcePathEntry);
      continue;
    } else {
      for (const destination of sourcePath.destinations) {
        let destinationDetails = sourcePathDetails.destinations.find(
          (item: any) =>
            item.destinationPathId === destination.destinationPathId,
        );
        log(traceId,`destinationDetails', ${JSON.stringify(destinationDetails)}`);
        if (destinationDetails && destinationDetails.status === 'failed') {
          sourcePathEntry.status = 'failed';
          let payload = {
            destinationPathId: destination.destinationPathId,
            status: 'failed',
            errors: [destinationDetails.errors],
          };
          sourcePathEntry.destination.push(payload);
          result.set(sourcePath.pathId, sourcePathEntry);
          continue;
        } else {
          const sourceValidationPromise = destinationDetails.commonWorkers.map(
            (worker) =>
              executeChild(ValidateWorkerConnectionWorkflow, {
                args: [
                  {
                    traceId,
                    fileServer: {
                      hostname: sourceServerCredentials.host,
                      protocols: [
                        {
                          type: sourceServerCredentials.protocol,
                          password: sourceServerCredentials.password,
                          username: sourceServerCredentials.userName,
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
                workflowId: `${WorkFlows.VALIDATE_CONNECTION}-${traceId}-source`,
                taskQueue: `${worker.workerId}-TaskQueue`,
                cancellationType:
                  ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
                parentClosePolicy: ParentClosePolicy.TERMINATE,
              }),
          );
          const sourceValidations = await Promise.all(sourceValidationPromise);
          log(traceId ,`sourceValidations', ${JSON.stringify(sourceValidations)}`);

          const destinationValidationPromise =
            destinationDetails.commonWorkers.map((worker) =>
              executeChild(ValidateWorkerConnectionWorkflow, {
                args: [
                  {
                    traceId,
                    fileServer: {
                      hostname: destination.destinationServerCredentials.host,
                      protocols: [
                        {
                          type: destination.destinationServerCredentials
                            .protocol,
                          password:
                            destination.destinationServerCredentials.password,
                          username:
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
              }),
            );
          const destinationValidations = await Promise.all(
            destinationValidationPromise,
          );
          const sourceValidationStatus = sourceValidations
            .flat()
            .every((validation) => validation.status === 'success');
          log(traceId,`sourceValidationStatus, ${JSON.stringify(sourceValidationStatus)}`);

          if (sourceValidationStatus) {
            const sourceMountAndWritePermissionValidationPromise =
              destinationDetails.commonWorkers.map((worker) =>
                executeChild(PreCheckMountAndWritePermissionValidation, {
                  args: [
                    {
                      traceId,
                      fileServer: {
                        hostname: sourceServerCredentials.host,
                        protocols: {
                          type: sourceServerCredentials.protocol,
                          password: sourceServerCredentials.password,
                          userName: sourceServerCredentials.userName,
                        },
                        pathId: sourcePath.pathId,
                        mountBasePath: sourcePath.mountBasePath,
                        exportPathName: sourcePath.exportPathName,
                        type: 'SOURCE',
                      },
                      feature: {
                        checkWritePermission: sourcePath.preserveAccessTime,
                      },
                    },
                  ],
                  workflowId: `${WorkFlows.PRECHECK}-${traceId}-${worker.workerId}-source-write-permission`,
                  taskQueue: `${worker.workerId}-TaskQueue`,
                  cancellationType:
                    ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
                  parentClosePolicy: ParentClosePolicy.TERMINATE,
                }),
              );
            const sourceMountAndWritePermissionValidations = await Promise.all(
              sourceMountAndWritePermissionValidationPromise,
            );
            log(traceId,
              `sourceMountAndWritePermissionValidations',
              ${JSON.stringify(sourceMountAndWritePermissionValidations)}`);
            sourceMountAndWritePermissionValidationStatus =
              sourceMountAndWritePermissionValidations.every(
                (validation) => validation.status === 'success',
              );
            if (!sourceMountAndWritePermissionValidationStatus) {
              const sourceWritePermissionErrors =
                sourceMountAndWritePermissionValidations
                  .filter((entry) => entry.status === 'failed')
                  .flatMap((entry) => entry.errors);
              sourcePathEntry.errors=[];
              sourcePathEntry.errors.push(...sourceWritePermissionErrors);
            }
            log(traceId,
              `sourceMountAndWritePermissionValidationStatus,
              ${sourceMountAndWritePermissionValidationStatus}`);
          }

          const destinationValidationStatus = destinationValidations
            .flat()
            .every((validation) => validation.status === 'success');
            log(traceId,
              `destinationValidationStatus,
              ${destinationValidationStatus}`);
              
          if (destinationValidationStatus) {
            const destinationMountAndWritePermissionValidationPromise =
              destinationDetails.commonWorkers.map((worker) =>
                executeChild(PreCheckMountAndWritePermissionValidation, {
                  args: [
                    {
                      traceId,
                      fileServer: {
                        hostname: destination.destinationServerCredentials.host,
                        protocols: {
                          type: destination.destinationServerCredentials
                            .protocol,
                          password:
                            destination.destinationServerCredentials.password,
                          userName:
                            destination.destinationServerCredentials.userName,
                        },
                        pathId: destination.destinationPathId,
                        mountBasePath:
                          destination.destinationServerCredentials
                            .mountBasePath,
                        exportPathName:
                          destination.destinationServerCredentials
                            .exportPathName,
                        type: 'DESTINATION',
                      },
                      feature: { checkWritePermission: true },
                    },
                  ],
                  workflowId: `${WorkFlows.PRECHECK}-${traceId}-${worker.workerId}-destination-write-permission`,
                  taskQueue: `${worker.workerId}-TaskQueue`,
                  cancellationType:
                    ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
                  parentClosePolicy: ParentClosePolicy.TERMINATE,
                }),
              );
            const destinationMountAndWritePermissionValidations =
              await Promise.all(
                destinationMountAndWritePermissionValidationPromise,
              );
            log(traceId,`destinationMountAndWritePermissionValidations', ${JSON.stringify(destinationMountAndWritePermissionValidations)}`);
            
            destinationMountAndWritePermissionValidationStatus =
              destinationMountAndWritePermissionValidations.every(
                (validation) => validation.status === 'success',
              );
              log(traceId,
                `destinationMountAndWritePermissionValidationStatus,
                ${destinationMountAndWritePermissionValidationStatus}`);

            if (!destinationMountAndWritePermissionValidationStatus) {
              let destinationPayload: any = {
                destinationPathId: destination.destinationPathId,
              };
              const destinationWritePermissionErrors =
                destinationMountAndWritePermissionValidations
                  .filter((entry) => entry.status === 'failed')
                  .flatMap((entry) => entry.errors);
             
              destinationPayload.status = 'failed';
              destinationPayload.errors=[];
              destinationPayload.errors.push(
                ...destinationWritePermissionErrors,
              );
              sourcePathEntry.destination.push(destinationPayload);
            }else{
              sourcePathEntry.destination.push({
                destinationPathId: destination.destinationPathId,
                status: 'success',
              });
            }
          }
          const isSourceValid =
            sourceValidationStatus &&
            sourceMountAndWritePermissionValidationStatus;
          const isDestinationValid =
            destinationValidationStatus &&
            destinationMountAndWritePermissionValidationStatus;
         

          sourcePathEntry.status = isSourceValid===true?'success':'failed';
          if (!sourceValidationStatus) {
            const sourceErrors = sourceValidations
              .flat()
              .filter((entry) => entry.status === 'error')
              .flatMap((entry) => entry.message);
            sourcePathEntry.errors=[];
            sourcePathEntry.errors.push(...sourceErrors);
          }
         

          if (!destinationValidationStatus) {
            let destinationPayload: any = {
              destinationPathId: destination.destinationPathId,
              status: isDestinationValid===true?'success':'failed',
            };
           log(traceId,`destinationValidations', ${JSON.stringify(destinationValidations)}`);
            const destinationErrors = destinationValidations
              .flat()
              .filter((entry) => entry.status === 'error')
              .flatMap((entry) => entry.message);
            destinationPayload.errors=[];
            log(traceId,`destinationErrors, ${destinationErrors}`);
            destinationPayload.errors.push(...destinationErrors);
            sourcePathEntry.destination.push(destinationPayload);
          }
          log(traceId,`'sourcePathEntry', ${JSON.stringify(sourcePathEntry)}`);
        }
      }
      result.set(sourcePath.pathId, sourcePathEntry);
    }
    log(traceId, 'Validating source server connection...');
  }
  return Array.from(result.values());
};
