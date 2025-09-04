import { INITIAL_VALUE_EXCLUDE_PATH_PATTERN } from "@/constant/app.constants";
import {
  AllFileServerWithVolumesApiType,
  BlueXpFormType,
  ProtocolType,
  ValidateConnectionStatus,
  JOBS_TYPE,
  BlueXpTableStateType,
} from "@/types/app.type";
import { convertFileToBase64, getOptionsFromArray } from "@/utils/common.utils";
import {
  useBulkMigrateMutation,
  useLazyGetAllFileServersWithVolumeQuery,
  usePrecheckMutation,
} from "@api/jobsApi";
import { useLazyCheckConnectionRespQuery } from "@api/workerManagerApi";
import { notify } from "@components/notification/NotificationWrapper";
import useFileServerDetails from "@hooks/useFileServerDetails";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import {
  DOW_OPTIONS,
  INCREMENTAL_SYNC_SCHEDULE_SET_ENUM,
  INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM,
  MIGRATE_OPTION_ENUM,
  OPTIONS_FORM,
  PRECHECK_STATUS,
  SKIP_FILE_OPTIONS,
  WEEK_OPTIONS,
  WEEKDAY_OPTIONS,
  OFFLINE_STATUS,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import {
  BulkMigrateContextType,
  bulkMigrateCreateApiType,
  DestinationPathsOptionsType,
  FormFileUploadType,
  MappingStepFormikFormType,
  MigrationDetailsTableConfigurationType,
  OptionsFormType,
  PreCheckStatusType,
  ProtocolFormType,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import {
  createPathMapping,
  createSelectedMountPathsObject,
  migratePathMapping,
  validateMappingStepForm,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";
import { Button, useForm, useTable } from "@netapp/bxp-design-system-react";
import dayjs from "dayjs";
import { useFormik } from "formik";
import { ComponentType, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BULK_MIGRATION_MOUNT_PATH_COL_DEFS } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import { MAX_RETRY_API_ATTEMPTS } from "@/utils/constants";
import { getPreCheckStatus, getPrecheckErrors } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/pre-check.utils";
import { Box } from "@components/container";
import { useDispatch } from "react-redux";
import {
  setModalClose,
  setModalProps,
} from "@store/reducer/commonComponentSlice";
import useFetchWorkers from "@hooks/useFetchWorkers";
import { INCREMENTAL_SYNC_SCHEDULE_ENUM } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/IncrementalSyncSchedule/incremental-sync-schedule.constants";

export function withBulkMigrateCreateForm(
  WrappedComponent: ComponentType<any>
) {
  return function WithBulkMigrateCreateFormComponent(props: any) {
    const interval = useRef<any | undefined>("");
    const navigate = useNavigate();
    const timeIntervalInSeconds = 15000;
    const { selectedProjectId: projectId } = useSelectedProjectId();
    const [selectedMountPathsId, setSelectedMountPathsId] = useState<string[]>(
      []
    );
    const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>([]);
    const [preCheckStatus, setPreCheckStatus] = useState<PreCheckStatusType>(
      {} as PreCheckStatusType
    );
    const [reviewIdsValidated, setReviewIdsValidated] = useState<string[]>([]);
    const [isPrecheckLoading, setIsPrecheckLoading] = useState<boolean>(false);
    const [isPrecheckSuccessful, setIsPrecheckSuccessful] =
      useState<boolean>(false);

    const [fileServerWithPathsMap, setFileServerWithPathsMap] = useState<
      Map<string, DestinationPathsOptionsType[]>
    >(new Map());
    const [
      migrationDetailsTableConfiguration,
      setMigrationDetailsTableConfiguration,
    ] = useState<MigrationDetailsTableConfigurationType[]>([]);
    const [allFileServers, setAllFileServers] = useState<
      AllFileServerWithVolumesApiType[]
    >([]);
    const [createBulkMigrateApi, { isLoading: isBulkMigrateSubmitting }] =
      useBulkMigrateMutation();
    const [preCheckApi, { isLoading: isPrecheckSubmitting }] =
      usePrecheckMutation();

    const {
      fileServerDetails,
      allExportPaths,
      allWorkersList,
      refetch,
      isFetching,
    } = useFileServerDetails();
    const [getAllFileServersApi] = useLazyGetAllFileServersWithVolumeQuery();
    const [getWorkerDetails] = useLazyCheckConnectionRespQuery();

    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [fileName, setFileName] = useState<string>("");

    const dispatch = useDispatch();

    const mappingStepForm = useFormik<MappingStepFormikFormType>({
      initialValues: {
        selectedMountPathsId: [],
        migrationDetailsTableConfigurationValue:
          [] as MigrationDetailsTableConfigurationType[],
        scheduleTime: "start_now",
        scheduledDateTime: dayjs().add(1, "minute"),
      },
      validate: validateMappingStepForm,
      onSubmit: () => {},
    });

    const [listOfNotReachableExportPaths, setListOfNotReachableExportPaths] =
      useState<string[]>([]);
    const [sourceDisabledPaths, setSourceDisabledPaths] = useState<string[]>(
      []
    );

    useEffect(() => {
      mappingStepForm.validateForm();
    }, [mappingStepForm.values]);

    // GET ALL FILE SERVERS LIST
    useEffect(() => {
      if (!fileServerDetails.id) return;
      (async () => {
        try {
          const resp = await getAllFileServersApi({ projectId }).unwrap();
          const allFileServers: AllFileServerWithVolumesApiType[] =
            resp?.configs;
          const _migrationTableDetails: MigrationDetailsTableConfigurationType[] =
            [];

          const _fileServerDetailsMap = new Map<
            string,
            DestinationPathsOptionsType[]
          >();

          fileServerDetails?.fileServers?.flatMap((fileServer) => {
            fileServer.volumes.forEach((volume, index) => {
              _migrationTableDetails.push({
                id: index,
                sourceFileServerDetails: fileServerDetails,
                protocol: fileServer.protocol,
                sourcePath: {
                  volume: volume,
                  sourcePathName: volume.volumePath,
                  sourcePathId: volume.id,
                },
                destinationFileServerDetails: {
                  destinationFileServerId: "",
                  destinationFileServerName: "",
                },
                destinationPathDetails: {
                  destinationPathId: "",
                  destinationPathName: "",
                },
                discoveryJobCount: "",
                migrationJobCount: "",
                cutoverJobCount: "",
              });
            });
          });
          const notReachableVolumes = [];
          const sourceDisabledPathsHashSet = [];
          allFileServers.forEach((config) => {
            const _destinationPaths: DestinationPathsOptionsType[] = [];
            config?.fileServers?.flatMap((fileServer) =>
              fileServer?.volumes?.map((volume) => {
                _destinationPaths.push({
                  protocol: fileServer.protocol,
                  pathId: volume?.id,
                  pathName: volume?.volumePath,
                  isDisabled: volume?.isDisabled,
                  isValid: volume?.isValid,
                  reachableCount: volume?.reachableCount,
                });
                if (volume?.reachableCount === 0) {
                  notReachableVolumes.push(volume.id);
                }
                if (volume?.isDisabled) {
                  sourceDisabledPathsHashSet.push(volume.id);
                }
              })
            );
            setSourceDisabledPaths(sourceDisabledPathsHashSet);
            setListOfNotReachableExportPaths(notReachableVolumes);
            _fileServerDetailsMap.set(config?.id, _destinationPaths);
          });

          mappingStepForm.setValues({
            selectedMountPathsId: [],
            migrationDetailsTableConfigurationValue: _migrationTableDetails,
            scheduleTime: "start_now",
            scheduledDateTime: dayjs().add(1, "minute"),
          });
          setFileServerWithPathsMap(_fileServerDetailsMap);
          setMigrationDetailsTableConfiguration(_migrationTableDetails);
          setAllFileServers(allFileServers);
        } catch (error) {
          console.error("Error fetching file servers:", error);
        }
      })();

      return () => {
        if (interval.current) {
          clearInterval(interval.current);
        }
      };
    }, [getAllFileServersApi, projectId, fileServerDetails.id]);

    const optionForm: BlueXpFormType<OptionsFormType> = useForm(
      {
        exclude_file_patterns: INITIAL_VALUE_EXCLUDE_PATH_PATTERN.replaceAll(
          ",",
          "\n"
        ),
        preserve_a_time: true,
        sid_mapping: "",
        uid_mapping: "",
        migrate_file_option: MIGRATE_OPTION_ENUM.ALL,
        migrate_file_option_exclude: dayjs().subtract(1, "day"),

        skipFileNum: 15,
        skipFileOption: SKIP_FILE_OPTIONS[0],

        incremental_sync_schedule: INCREMENTAL_SYNC_SCHEDULE_ENUM.OFF,
        incremental_sync_schedule_daily: dayjs().hour(10).minute(30),
        incremental_sync_schedule_set:
          INCREMENTAL_SYNC_SCHEDULE_SET_ENUM.HOURLY,
        incremental_sync_schedule_weekly:
          INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM.DAY,
        incremental_sync_schedule_weekly_day: DOW_OPTIONS[0],
        incremental_sync_schedule_weekly_day_week: WEEK_OPTIONS[0],
        incremental_sync_schedule_weekly_weekday: WEEKDAY_OPTIONS[0],
        incremental_sync_schedule_weekly_weekday_week: WEEK_OPTIONS[0],
        incremental_sync_schedule_cron_expression: "* * * * *",
        incremental_sync_schedule_cron_expression_error: "",
      },
      OPTIONS_FORM
    );

    const protocolForm: BlueXpFormType<ProtocolFormType> = useForm({
      protocol: getOptionsFromArray([ProtocolType.NFS])[0],
    });

    const getFutureRun = () => {
      switch (optionForm.formState.incremental_sync_schedule) {
        case INCREMENTAL_SYNC_SCHEDULE_ENUM.CRON_EXPRESSION:
          return optionForm.formState.incremental_sync_schedule_cron_expression;
        case INCREMENTAL_SYNC_SCHEDULE_ENUM.SCHEDULE: {
          if (
            optionForm.formState.incremental_sync_schedule_set ===
            INCREMENTAL_SYNC_SCHEDULE_SET_ENUM.HOURLY
          )
            return "0 * * * *";
          if (
            optionForm.formState.incremental_sync_schedule_set ===
            INCREMENTAL_SYNC_SCHEDULE_SET_ENUM.DAILY
          ) {
            return `${optionForm.formState.incremental_sync_schedule_daily.minute()} ${optionForm.formState.incremental_sync_schedule_daily.hour()} * * *`;
          } else {
            if (
              optionForm.formState.incremental_sync_schedule_weekly ===
              INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM.DAY
            ) {
              return `0 0 * * ${
                +optionForm.formState.incremental_sync_schedule_weekly_day
                  .value - 1
              }`;
            } else {
              return `0 0 * * ${optionForm.formState.incremental_sync_schedule_weekly_weekday.value}`;
            }
          }
        }
        case INCREMENTAL_SYNC_SCHEDULE_ENUM.OFF:
        default:
          return "";
      }
    };

    const showErrorOnFailure = (error: Error) => {
      setIsPrecheckLoading(false);
      setIsSubmitting(false);
      if (interval.current) {
        clearInterval(interval.current);
      }

      notify.error(
        `Failed to perform precheck, reason - ${error?.message || "unknown."}`
      );
      console.error({ level: "Bulk Migrate - Precheck.", error });
    };

    const onsubmit = (onSuccessfulSubmit?: () => void) => {
      handleSubmit(onSuccessfulSubmit);
      dispatch(setModalClose());
    };

    const createModalContent = () => (
      <Box className="flex flex-col gap-10 text-gray-700 font-light">
        Insufficient destination space for the selected path. Do you still want
        to proceed with the migration?
      </Box>
    );

    const createModalFooter = (onSuccessfulSubmit?: () => void) => (
      <>
        <Button color="secondary" onClick={() => onsubmit(onSuccessfulSubmit)}>
          Proceed
        </Button>
        <Button onClick={() => dispatch(setModalClose())}>Cancel</Button>
      </>
    );

    // Use the hook to get workers
    const { workers } = useFetchWorkers();

    // Define the type for a worker object
    type WorkerType = {
      status: string;
      workerName?: string;
      workerId?: string;
    };
    // Helper to check if any worker is offline
    // Proceed with remaining workers even if some are offline; just warn
    const validateWorkerStatus = () => {
      const availableWorkers = workers || [];
      const offlineWorkers = availableWorkers.filter(
        (w: WorkerType) => w.status && w.status.toLowerCase() === OFFLINE_STATUS
      );
      if (
        availableWorkers.length > 0 &&
        offlineWorkers.length === availableWorkers.length
      ) {
        throw new Error(
          `All workers are offline. Please ensure at least one worker is online before proceeding.`
        );
      }
      if (offlineWorkers.length > 0) {
        notify.warning(
          `Some workers are offline: ${offlineWorkers
            .map((w: WorkerType) => w.workerName || w.workerId)
            .join(", ")}. Proceeding with available workers.`
        );
      }
    };

    const handlePrecheckErrorState = (data: any, errorMessage: string, interval: React.RefObject<number | null>) => {
      const precheckState = getPrecheckErrors(data);

      if (
        precheckState &&
        precheckState.errors?.length !== 0 &&
        precheckState.errors[0]?.errors?.length !== 0
      ) {
        setPreCheckStatus(precheckState);
        setIsPrecheckLoading(false);
        setIsSubmitting(false);
        if (interval.current) {
          clearInterval(interval.current);
        }
      } else {
        const error = new Error(errorMessage);
        showErrorOnFailure(error);
      }
    };

    const handlePrecheck = (onSuccessfulSubmit?: () => void) => {
      let retryCount = 0;
      setReviewIdsValidated(selectedReviewIds);
      setIsPrecheckLoading(true);
      setIsPrecheckSuccessful(false);
      setPreCheckStatus(PRECHECK_STATUS);
      setIsSubmitting(true);
      // Check worker status before proceeding
      try {
        validateWorkerStatus();
      } catch (err: any) {
        showErrorOnFailure(err);
        return;
      }
      const body = {
        migrateConfigs: createPathMapping(
          mappingStepForm?.values?.migrationDetailsTableConfigurationValue,
          mappingStepForm?.values?.selectedMountPathsId
        ),

        preserveAccessTime: optionForm.formState?.preserve_a_time,
      };

      preCheckApi(body)
        .unwrap()
        .then((res) => {
          interval.current = setInterval(async () => {
            const data = await getWorkerDetails({
              id: res?.workflowId,
            }).unwrap();
            if (data?.status === ValidateConnectionStatus.COMPLETED) {
              const precheckState = getPreCheckStatus(data);
              setPreCheckStatus(precheckState);
              setIsPrecheckLoading(false);
              if (interval.current) {
                clearInterval(interval.current);
              }
              setIsSubmitting(false);
              if (precheckState.errors.length === 0) {
                if (
                  precheckState?.warnings &&
                  precheckState.warnings.length > 0
                ) {
                  const warning = precheckState.warnings.filter((warning) =>
                    warning?.warnings?.includes(
                      "INSUFFICIENT_DESTINATION_SPACE"
                    )
                  );
                  if (warning.length > 0) {
                    dispatch(
                      setModalProps({
                        isOpen: true,
                        modalHeader: "Confirmation to proceed with migration",
                        modalContent: createModalContent(),
                        modalFooter: createModalFooter(onSuccessfulSubmit),
                      })
                    );
                  } else {
                    handleSubmit(onSuccessfulSubmit);
                  }
                } else {
                  handleSubmit(onSuccessfulSubmit);
                }
              }
            } else if (data?.status === ValidateConnectionStatus.FAILED) {
              handlePrecheckErrorState(
                data,
                `Seems like pre-check got failed, please try again.`,
                interval
              );
            } else if (data?.status === ValidateConnectionStatus.TERMINATED) {
              handlePrecheckErrorState(
                data,
                `Seems like pre-check got terminated, please try again.`,
                interval
              );
            } else if (data?.status === ValidateConnectionStatus.TIMED_OUT) {
              handlePrecheckErrorState(
                data,
                `Precheck timed out. This may be due to an unhealthy worker. Please check the worker's status and try again.`,
                interval
              );
            } else if (++retryCount === MAX_RETRY_API_ATTEMPTS) {
              const error = new Error(
                `Request timed out after ${MAX_RETRY_API_ATTEMPTS} attempts. Possibly due to an unhealthy worker.`
              );
              showErrorOnFailure(error);
            }
          }, timeIntervalInSeconds);
        })
        .catch((err) => {
          if (
            err?.errors &&
            err.errors.includes("MIGRATION_CONFLICTS_FOUND")
          ) {
            setPreCheckStatus({
              success: [],
              failed: [],
              errors: [],
              warnings: [],
              migrationConflicts: err.details || [],
            });
            setIsPrecheckLoading(false);
            setIsSubmitting(false);
            if (interval.current) {
              clearInterval(interval.current);
            }
          } else {
            showErrorOnFailure(err);
          }
        });
    };

    const handleSubmit = async (onSuccessfulSubmit?: () => void) => {
      const sid_mapping: FormFileUploadType | undefined =
        optionForm.formState.upload_sid_mapping;
      const uid_mapping: FormFileUploadType | undefined =
        optionForm.formState.upload_uid_mapping;

      const body: bulkMigrateCreateApiType = {
        firstRunAt:
          mappingStepForm.values.scheduleTime === "start_now"
            ? undefined
            : mappingStepForm.values.scheduledDateTime,
        futureRunSchedule: getFutureRun(),
        migrateConfigs: createPathMapping(
          mappingStepForm?.values?.migrationDetailsTableConfigurationValue,
          mappingStepForm?.values?.selectedMountPathsId
        ),
        sidMapping:
          protocolForm.formState.protocol.value === ProtocolType.SMB &&
          sid_mapping
            ? await convertFileToBase64(
                new Blob([sid_mapping?.contents], {
                  type: "text/csv;charset=utf-8",
                })
              )
            : undefined,
        gidMapping:
          protocolForm.formState.protocol.value === ProtocolType.NFS &&
          uid_mapping
            ? await convertFileToBase64(
                new Blob([uid_mapping.contents], {
                  type: "text/csv;charset=utf-8",
                })
              )
            : undefined,
        options: {
          excludeOlderThan:
            optionForm.formState?.migrate_file_option ===
            MIGRATE_OPTION_ENUM.EXCLUDE
              ? optionForm.formState?.migrate_file_option_exclude
              : undefined,
          excludeFilePatterns:
            optionForm.formState.exclude_file_patterns?.replaceAll("\n", ","),
          preserveAccessTime: optionForm.formState?.preserve_a_time,
          skipFile: `${optionForm.formState?.skipFileNum}-${optionForm.formState?.skipFileOption?.value}`,
        },
      };

      const configName = fileServerDetails?.configName;
      const successMessage = (
        <>
          Bulk Migrate Job has been created.
          <Button
            variant="text"
            onClick={() =>
              navigate(
                `/jobs-list?source=${configName}&type=${JOBS_TYPE.MIGRATE}`
              )
            }
          >
            View Job Listing
          </Button>
        </>
      );

      createBulkMigrateApi(body)
        .unwrap()
        .then((migrateResponse) => {
          const migrateConfigs = migratePathMapping(
            mappingStepForm?.values?.migrationDetailsTableConfigurationValue,
            mappingStepForm?.values?.selectedMountPathsId
          );

          if (migrateResponse?.warnings) {
            const erroredStatus = handleBulkMigrateWarning(
              migrateConfigs,
              migrateResponse
            );
            notify.error(erroredStatus);
          } else {
            notify.success(successMessage, 15000);
            onSuccessfulSubmit?.();
          }
        })
        .catch((err) => {
          notify.error(err?.data?.message || "Bulk Migrate failed.");
          console.error(err);
        });
    };

    const handleBulkMigrateWarning = (migrateConfigs, migrateResponse) => {
      const errorItems = [];

      migrateConfigs.forEach(
        ({
          sourcePathId,
          destinationPathId,
          sourcePathName,
          destinationPathName,
        }) => {
          destinationPathId.forEach((destId) => {
            const warning = migrateResponse?.warnings.find(
              ({ sourcePathId: srcId, targetPathId }) =>
                srcId === sourcePathId && targetPathId === destId
            );

            if (warning) {
              errorItems.push(
                `Source Path: ${sourcePathName} & Destination Path: ${destinationPathName} are failed due to ${warning?.message}`
              );
            }
          });
        }
      );

      return formattedMessage(errorItems);
    };

    const formattedMessage = (errorItems: string[]) => {
      return (
        <ul className="list-disc pl-5 space-y-1">
          {errorItems.map((error: string, index: number) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      );
    };

    // Migration Table
    const mappingStepTableState: BlueXpTableStateType<any> = useTable({
      columns: BULK_MIGRATION_MOUNT_PATH_COL_DEFS,
      rows: mappingStepForm?.values?.migrationDetailsTableConfigurationValue?.filter(
        (row) => row.protocol === protocolForm.formState.protocol.value
      ),
      isSorting: true,
      isRowSelecting: true,
      defaultSelectionState: {
        rows: createSelectedMountPathsObject(
          mappingStepForm?.values?.selectedMountPathsId
        ),
      },
      pageSize: 10,
    });

    const createBulkMigrateHelpers: BulkMigrateContextType = {
      migrationDetailsTableConfiguration,
      setMigrationDetailsTableConfiguration,
      sourceFileServerDetails: fileServerDetails,
      allExportPaths,
      allWorkersList,
      allFileServers,
      mappingStepForm,
      fileServerWithPathsMap,
      selectedMountPathsId,
      optionForm,
      setSelectedMountPathsId,
      handleSubmit: handlePrecheck,
      selectedReviewIds,
      setSelectedReviewIds,
      isPrecheckLoading,
      isPrecheckSuccessful,
      preCheckStatus,
      reviewIdsValidated,
      isFormSubmitting:
        isPrecheckSubmitting || isSubmitting || isBulkMigrateSubmitting,
      protocolForm,
      mappingStepTableState,
      setFileName,
      fileName,
      listOfNotReachableExportPaths,
      sourceDisabledPaths,
      refetch,
      isFetching,
    };

    return <WrappedComponent {...props} {...createBulkMigrateHelpers} />;
  };
}
