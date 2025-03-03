import useFileServerDetails from "@hooks/useFileServerDetails";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import {
  useLazyGetAllFileServersWithVolumeQuery,
  useBulkMigrateMutation,
  usePrecheckMutation,
} from "@api/jobsApi";
import {
  AllFileServerWithVolumesApiType,
  BlueXpFormType,
} from "@/types/app.type";
import dayjs from "dayjs";
import { useFormik } from "formik";
import { ComponentType, useEffect, useState } from "react";
import {
  BulkMigrateContextType,
  DestinationPathsOptionsType,
  MappingStepFormikFormType,
  MigrationDetailsTableConfigurationType,
  OptionsFormType,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import {
  DOW_OPTIONS,
  INCREMENTAL_SYNC_SCHEDULE_ENUM,
  INCREMENTAL_SYNC_SCHEDULE_SET_ENUM,
  INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM,
  MIGRATE_OPTION_ENUM,
  OPTIONS_FORM,
  SKIP_FILE_OPTIONS,
  WEEK_OPTIONS,
  WEEKDAY_OPTIONS,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import { INITIAL_VALUE_EXCLUDE_PATH_PATTERN } from "@/utils/constants";
import { Button, useForm } from "@netapp/bxp-design-system-react";
import { notify } from "@components/notification/NotificationWrapper";
import {
  createPathMapping,
  validateMappingStepForm,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";
import { useNavigate } from "react-router-dom";

export function withBulkMigrateCreateForm(
  WrappedComponent: ComponentType<any>
) {
  return function withBulkMigrateCreateFormComponent(props: any) {
    const { selectedProjectId: projectId } = useSelectedProjectId();
    const [selectedMountPathsId, setSelectedMountPathsId] = useState<string[]>(
      []
    );
    const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>([]);
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
      //TODO: Remove this once Precheck API is fixed.
      // Disabled Precheck as this is impacting worker and migration is failing.
      setIsPrecheckSuccessful(true);
      handleSubmit(onSuccessfulSubmit);
      return;
      // Disabled Precheck

      setReviewIdsValidated(selectedReviewIds);
      setIsPrecheckLoading(true);
      setIsPrecheckSuccessful(false);
      const body = {
        migrateConfigs: createPathMapping(
          mappingStepForm?.values?.migrationDetailsTableConfigurationValue,
          mappingStepForm?.values?.selectedMountPathsId
        ),
        preserveAccessTime: false, //TODO: There is limitation in Precheck API due to which we need to forcefully send preserveAccessTime False during precheck
      };

      preCheckApi(body)
        .unwrap()
        .then(() => {
          setIsPrecheckSuccessful(true);
          handleSubmit(onSuccessfulSubmit);
        })
        .catch((err) => {
          notify.error("There are some errors in Precheck!");
        })
        .finally(() => {
          setIsPrecheckLoading(false);
        });
    };

    const handleSubmit = (onSuccessfulSubmit?: Function) => {
      const sid_mapping: any = optionForm.formState.upload_sid_mapping;
      const uid_mapping: any = optionForm.formState.upload_uid_mapping;

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
        sidMapping: sid_mapping
          ? new Blob([sid_mapping], { type: sid_mapping?.type })
          : "",
        gidMapping: uid_mapping
          ? new Blob([uid_mapping], { type: uid_mapping?.type })
          : "",
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

      const successMessage = (
        <>
          Bulk Migrate Job has been created.
          <Button variant="text" onClick={() => navigate("/jobs-list")}>
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
      reviewIdsValidated,
      isFormSubmitting: isPrecheckSubmitting || isBulkMigrateSubmitting,
    };

    return <WrappedComponent {...props} {...createBulkMigrateHelpers} />;
  };
}
