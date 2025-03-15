import {
  AllFileServerWithVolumesApiType,
  BlueXpFormType,
  ProtocolType,
  ValidateConnectionStatus,
} from "@/types/app.type";
import {
  useBulkMigrateMutation,
  useLazyGetAllFileServersWithVolumeQuery,
  usePrecheckMutation,
} from "@api/jobsApi";
import { notify } from "@components/notification/NotificationWrapper";
import useFileServerDetails from "@hooks/useFileServerDetails";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import {
  DOW_OPTIONS,
  INCREMENTAL_SYNC_SCHEDULE_ENUM,
  INCREMENTAL_SYNC_SCHEDULE_SET_ENUM,
  INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM,
  MIGRATE_OPTION_ENUM,
  OPTIONS_FORM,
  PRECHECK_STATUS,
  SKIP_FILE_OPTIONS,
  WEEK_OPTIONS,
  WEEKDAY_OPTIONS,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import {
  BulkMigrateContextType,
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
  validateMappingStepForm,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";
import { Button, useForm } from "@netapp/bxp-design-system-react";
import dayjs from "dayjs";
import { useFormik } from "formik";
import { ComponentType, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLazyCheckConnectionRespQuery } from "@api/workerManagerApi";
import { getPreCheckStatus } from "../components/steps/Review/Review.utils";
import { INITIAL_VALUE_EXCLUDE_PATH_PATTERN } from "@/constant/app.constants";
import { getOptionsFromArray, convertFileToBase64 } from "@/utils/common.utils";

export function withBulkMigrateCreateForm(
  WrappedComponent: ComponentType<any>
) {
  return function withBulkMigrateCreateFormComponent(props: any) {
    const interval = useRef<any | undefined>("");

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

    const { fileServerDetails, allExportPaths, allWorkersList } =
      useFileServerDetails();
    const [getAllFileServersApi] = useLazyGetAllFileServersWithVolumeQuery();
    const [getWorkerDetails] = useLazyCheckConnectionRespQuery();

    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

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

    const navigate = useNavigate();

    useEffect(() => {
      mappingStepForm.validateForm();
    }, [mappingStepForm.values]);

    // GET ALL FILE SERVERS LIST
    useEffect(() => {
      if (!fileServerDetails.id) return;
      (async () => {
        try {
          const resp = await getAllFileServersApi({ projectId }).unwrap();
          let allFileServers: AllFileServerWithVolumesApiType[] = resp?.configs;
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

          allFileServers.forEach((config) => {
            const _destinationPaths: DestinationPathsOptionsType[] = [];
            config?.fileServers?.flatMap((fileServer) =>
              fileServer?.volumes?.map((volume) =>
                _destinationPaths.push({
                  protocol: fileServer.protocol,
                  pathId: volume?.id,
                  pathName: volume?.volumePath,
                })
              )
            );
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
        interval.current && clearInterval(interval.current);
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
            //TODO: need to handle case for weekly
            return "* * * * *";
          }
        }
        case INCREMENTAL_SYNC_SCHEDULE_ENUM.OFF:
        default:
          return "";
      }
    };

    const handlePrecheck = (onSuccessfulSubmit?: Function) => {
      setReviewIdsValidated(selectedReviewIds);
      setIsPrecheckLoading(true);
      setIsPrecheckSuccessful(false);
      setPreCheckStatus(PRECHECK_STATUS);
      setIsSubmitting(true);
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
              interval.current && clearInterval(interval.current);
              setIsSubmitting(false);
              if (precheckState.errors.length === 0) {
                handleSubmit(onSuccessfulSubmit);
              }
            }
          }, 2000);
        })
        .catch((e) => console.error("precheck failed", e));
    };

    const handleSubmit = async (onSuccessfulSubmit?: Function) => {
      const sid_mapping: FormFileUploadType | undefined =
        optionForm.formState.upload_sid_mapping;
      const uid_mapping: FormFileUploadType | undefined =
        optionForm.formState.upload_uid_mapping;

      const body = {
        firstRunAt:
          mappingStepForm.values.scheduleTime === "start_now"
            ? new Date().toISOString()
            : mappingStepForm.values.scheduledDateTime,
        futureRunSchedule: getFutureRun(),
        migrateConfigs: createPathMapping(
          mappingStepForm?.values?.migrationDetailsTableConfigurationValue,
          mappingStepForm?.values?.selectedMountPathsId
        ),
        sid_mapping:
          protocolForm.formState.protocol.value === ProtocolType.SMB &&
          sid_mapping &&
          (await convertFileToBase64(
            new Blob([sid_mapping?.contents], {
              type: "text/csv;charset=utf-8",
            })
          )),
        gidMapping:
          protocolForm.formState.protocol.value === ProtocolType.NFS &&
          uid_mapping &&
          (await convertFileToBase64(
            new Blob([uid_mapping.contents], {
              type: "text/csv;charset=utf-8",
            })
          )),
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
          <Button variant="text" onClick={() => navigate(`/jobs-list?source=${configName}&type=${'migrate'}`)}>
            View Job Listing
          </Button>
        </>
      );

      createBulkMigrateApi(body)
        .unwrap()
        .then(() => {
          notify.success(successMessage, 15000);
          onSuccessfulSubmit && onSuccessfulSubmit();
        })
        .catch((err) => {
          notify.error("Bulk Migrate failed.");
          console.error(err);
        });
    };

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
    };

    return <WrappedComponent {...props} {...createBulkMigrateHelpers} />;
  };
}
