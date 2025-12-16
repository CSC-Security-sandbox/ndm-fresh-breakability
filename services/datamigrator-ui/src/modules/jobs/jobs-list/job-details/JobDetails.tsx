import PermissionAuth from "@/auth/PermissionAuth";
import {
  JOB_ACTION_STATUS_ENUM,
  JOB_CONFIG_STATUS_ENUM,
  JOB_STATUS_TYPE_ENUM,
  BlueXpFormType,
  JobRunApiType,
  JOBS_TYPE,
  ProtocolType,
} from "@/types/app.type";
import {
  useGetJobConfigDetailsQuery,
  useLazyDownloadTemplateQuery,
  useUpdateJobRunStatusMutation,
  useGetJobIdentityMappingsQuery,
  useUpdateDiscoveryJobConfigMutation,
  useUpdateMigrationJobConfigMutation,
  useRemoveJobIdentityMappingsMutation, 
} from "@api/jobsApi";
import {
  useDownloadReportsMutation,
  useGetPdfReportMutation,
  useIsErrorLogsCsvReadyQuery,
  useLazyDownloadErrorLogsCSVQuery,
  useLazyGenerateErrorLogsQuery,
} from "@api/reportApi";
import { convertFileToBase64 } from "@/utils/common.utils";
import { hasPermission } from "@auth/auth.utils";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { Box } from "@components/container/index";
import CutoverConfirmationModal from "@components/modal/CutOverConfirmationModal";
import { notify } from "@components/notification/NotificationWrapper";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import TitleWithLastRefreshedDate from "@components/TitleWithLastRefreshedDate/TitleWithLastRefreshedDate";
import useAdhocRun from "@hooks/useAdhocRun";
import { useLatestJobRun } from "@/hooks/useLatestJobRun";
import { getActionMenu, getReportActions } from "@modules/jobs/job-run-list/run.utils";
import { ErrorLogActionButton } from "@modules/jobs/job-task-errors/components/ErrorLogActionButton";
import { DOWNLOAD_BULK_ERROR_REPORT, GENERATE_BULK_ERROR_REPORT } from "@modules/jobs/job-task-errors/jobTaskErrors.constant";
import JobDescription from "@modules/jobs/jobs-list/job-details/components/JobDescription";
import JobErrors from "@modules/jobs/jobs-list/job-details/components/JobErrors";
import JobHeader from "@modules/jobs/jobs-list/job-details/components/JobHeader";
import { JOB_RUN_LIST_COLUMN_DEFS } from "@modules/jobs/jobs-list/job-details/job-details.constants";
import { handleDownloadCocReport, handleDownloadErrorsLogs, handleDownloadReport } from "@modules/jobs/jobs.utils";
import ScheduleComponent from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/components/ScheduleComponent";
import {
  BULK_DISCOVERY_FORM_SCHEMA,
  DEFAULT_MINUTES_AHEAD as DISCOVERY_DEFAULT_MINUTES_AHEAD,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/bulk-discover.constant";
import { parseIncrementalSchedule, parseSkipFiles } from "@modules/jobs/jobs-list/job-details/job-details.utils";
import { bulkDiscoveryFormType } from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/bulk-discovery.interface";
import {
  SKIP_FILE_OPTIONS, OPTIONS_FORM, MIGRATE_OPTION_ENUM,
  DEFAULT_MINUTES_AHEAD  as MIGRATE_DEFAULT_MINUTES_AHEAD
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import { MappingStepFormikFormType, OptionsFormType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import { handleDownloadTemplate, validateMappingStepForm } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";
import DateTimePickerWrapper from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/MigrateFileOption/ExcludeDateTimePickerWrapper";
import BulkMigrateScheduleComponent from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/BulkMigrateScheduleComponent";
import BulkMigrateContextProvider from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { withBulkMigrateCreateForm } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/withBulkMigrateCreateForm";
import {
  Breadcrumbs, Button, FormFieldInputNew, FormFieldSelect, FormFieldTextArea,
  FormFieldUploadFile, Heading, Popover, RadioButton, Text, Toggle, useForm,
} from "@netapp/bxp-design-system-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch } from "react-redux";
import { setModalClose, setModalProps } from "@store/reducer/commonComponentSlice";
import { useFormik } from "formik";
import dayjs from "dayjs";
import ExistingIdentityMappings from "@/hooks/useExistingIdentityMappings";
import IncrementalSyncSchedule from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/IncrementalSyncSchedule/IncrementalSyncSchedule";

type DownloadTemplateTrigger = ReturnType<
  typeof useLazyDownloadTemplateQuery
>[0];

const JobDetails = () => {
  const dispatch = useDispatch();
  const LOWER_TIME_INTERVAL_FOR_IN_PROGRESS = 5000; // 5 seconds
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const adhocRun = useAdhocRun();
  const [openConfirmation, setOpenConfirmation] = useState(false);
  const [selectedJobRunId, setSelectedJobRunId] = useState("");
  const [isFrequentInterval, setIsFrequentInterval] = useState<boolean>(false);
  const [showGeneratingReportBtn, setShowGeneratingReportBtn] =
    useState<Record<string, boolean>>();
  const {
    data: jobConfigDetails,
    isLoading,
    refetch,
    isFetching,
  } = useGetJobConfigDetailsQuery(
    { jobConfigId: jobId },
    {
      pollingInterval: isFrequentInterval
        ? LOWER_TIME_INTERVAL_FOR_IN_PROGRESS
        : Number(
            window?.env?.VITE_TIME_INTERVAL ||
              import.meta.env.VITE_TIME_INTERVAL
          ),
      skipPollingIfUnfocused: true,
    }
  );
  const [downloadErrorLogs] = useLazyDownloadErrorLogsCSVQuery();
  const [generateErrorLogs] = useLazyGenerateErrorLogsQuery();
  const [downloadTemplateApi] = useLazyDownloadTemplateQuery();
  const [removeJobIdentityMappings, { isLoading: isRemovingMappings }] = useRemoveJobIdentityMappingsMutation();
  const BulkMigrateContextWrapper = withBulkMigrateCreateForm(
    BulkMigrateContextProvider
  );
  const { data } = useIsErrorLogsCsvReadyQuery(
    { type: "job-config", id: jobId },
    {
      pollingInterval: Number(
        window?.env?.VITE_TIME_INTERVAL || import.meta.env.VITE_TIME_INTERVAL
      ),
      skipPollingIfUnfocused: true,
      skip: !jobId,
    }
  );

  useEffect(() => {
    if (jobConfigDetails?.jobRuns?.length === 0) {
      setIsFrequentInterval(true);
    } else {
      setIsFrequentInterval(false);
    }
  }, [jobConfigDetails?.jobRuns?.length]);

  const [downloadReportApi] = useDownloadReportsMutation();
  const [getPdfReportApi] = useGetPdfReportMutation();
  const canDownloadReport = hasPermission(USER_PERMISSION_TYPE_ENUM.Reports);
  const [updateStatus, { isLoading: isUpdating }] = useUpdateJobRunStatusMutation();
  const [updateDiscoveryConfig, { isLoading: isUpdatingDiscoveryConfig }] = useUpdateDiscoveryJobConfigMutation();
  const [updateMigrationConfig, { isLoading: isUpdatingMigrationConfig }] = useUpdateMigrationJobConfigMutation();
  
  const handleUpdateStatus = async (
    jobRunId: JobRunApiType["jobRunId"],
    status: JOB_ACTION_STATUS_ENUM
  ) => {
    try {
      await updateStatus({ ids: [jobRunId], status }).unwrap();
      notify.success("Successfully updated the status of Job.");
    } catch (error) {
      notify.error("Failed to update Job Status.");
      console.error(error);
    }
  };
  const canUpdateStatus = hasPermission(USER_PERMISSION_TYPE_ENUM.ManageJob);

  const rowMenu = (row: JobRunApiType) => {
    const reportMenu = canDownloadReport
      ? getReportActions(
          row,
          handleDownloadReport,
          handleDownloadCocReport,
          downloadReportApi,
          getPdfReportApi
        )
      : [];

    const actionMenu = canUpdateStatus
      ? getActionMenu({
          jobRunId: row.jobRunId,
          status: row.status,
          handleUpdateStatus,
          isDisabled: isLoading || isUpdating,
          adhocRun: () => adhocRun(jobId),
        })
      : [];

    const enableCutOver =
      row?.jobType === JOBS_TYPE.CUT_OVER &&
      row?.status === JOB_STATUS_TYPE_ENUM.BLOCKED
        ? [
            {
              label: "Review",
              onClick: () => {
                setOpenConfirmation(true);
                setSelectedJobRunId(row.jobRunId);
              },
            },
          ]
        : [];
    return [
      {
        label: "Details",
        onClick: () => {
          navigate(`/job-details/${jobId}/run/${row.jobRunId}`);
        },
      },
      ...reportMenu,
      ...actionMenu,
      ...enableCutOver,
    ];
  };

  const closeConfirmationBox = () => {
    setOpenConfirmation(false);
    setSelectedJobRunId("");
  };

  const defaultColumnState = { scannedDirectoriesCount: { isHidden: true } };

  const tableStateProps = {
    columns: JOB_RUN_LIST_COLUMN_DEFS,
    rows: jobConfigDetails?.jobRuns,
    isSorting: true,
    pageSize: 10,
    defaultColumnState,
    defaultSortState: { sortOrder: "desc", column: "startTime" },
  };

  const errorsCount = useMemo(() => {
    if (!jobConfigDetails?.jobRuns) return [];
    return jobConfigDetails.jobRuns.flatMap((run) =>
      run.errors ? run.errors.map((error) => error.count || 0) : []
    );
  }, [jobConfigDetails]);

  const { latestJobRun, latestJobRunId } = useLatestJobRun(
    jobConfigDetails?.jobRuns
  );

  useEffect(() => {
    if (data?.ready || data?.processing) {
      setShowGeneratingReportBtn({});
    }
  }, [data]);

  const generateErrorReport = async () => {
    try {
      await generateErrorLogs({ type: "job-config", id: jobId }).unwrap();
      setShowGeneratingReportBtn({
        ready: false,
        processing: true,
      });
      notify.success("Error Report generation started successfully.");
    } catch (error) {
      const errorMsg = "Error while downloading error logs.";
      notify.error(error?.data?.displayMessage || errorMsg);
      console.error(`errorMsg ${error?.data?.message}`);
    }
  };

  const isDisplayGeneratingLabel = useMemo(() => {
    const hasReportData =
      showGeneratingReportBtn && Object.keys(showGeneratingReportBtn).length;
    return hasReportData ? showGeneratingReportBtn : data;
  }, [showGeneratingReportBtn]);

  const errorLogContent = useMemo(() => {
    return (
      <ErrorLogActionButton
        generateLabel={GENERATE_BULK_ERROR_REPORT}
        downloadLabel={DOWNLOAD_BULK_ERROR_REPORT}
        data={isDisplayGeneratingLabel}
        disabled={errorsCount.length === 0}
        handleGenerate={generateErrorReport}
        handleDownload={() =>
          handleDownloadErrorsLogs(
            downloadErrorLogs,
            { type: "job-config", id: jobId },
            "CSV"
          )
        }
      />
    );
  }, [jobId, downloadErrorLogs, generateErrorReport]);

  const isJobCurrentlyRunning = ( details = jobConfigDetails ) => {
    if (!details?.jobRuns?.length) return false;
    const activeStatuses = [
      JOB_STATUS_TYPE_ENUM.RUNNING,
      JOB_STATUS_TYPE_ENUM.PENDING,
      JOB_STATUS_TYPE_ENUM.PAUSING,
      JOB_STATUS_TYPE_ENUM.PAUSED,
      JOB_STATUS_TYPE_ENUM.READY,
      JOB_STATUS_TYPE_ENUM.STOPPING,
    ];
    return details.jobRuns.some(jobRun => activeStatuses.includes(jobRun.status));
  };

  // common configurations
  const configurationsSetToJob = jobConfigDetails?.configurationsSetToJob;
  const excludeFilePatterns = configurationsSetToJob?.["Excluded Path Patterns"];
  const jobScheduledFor = configurationsSetToJob?.["Job Scheduled For"];
  const isScheduledForFuture = jobScheduledFor ? dayjs.utc(jobScheduledFor).isAfter(dayjs.utc()) : false;
  const jobProtocol = jobConfigDetails?.sourceServer?.protocol;
  const preserveATime = configurationsSetToJob?.["Preserve a-time"];
  const skipFilesModified = configurationsSetToJob?.["Skip Files modified in last"] || "-";

  const MigrationConfigDetailsModalContent = ({
    downloadTemplateApi, onSave, isLoading, jobId
  }: {
    downloadTemplateApi: DownloadTemplateTrigger;
    onSave: (data: any) => void;
    isLoading: boolean;
    jobId?: string;
  }) => {
    const { data: modalJobConfigDetails } = useGetJobConfigDetailsQuery(
      { jobConfigId: jobId },
      { skip: !jobId }
    );
    const isModalJobRunning = useMemo(
      () => isJobCurrentlyRunning(modalJobConfigDetails),
      [modalJobConfigDetails?.jobRuns]
    );

    const {
      data: existingMappings,
      isFetching: isMappingsLoading,
      refetch: refetchMappings,
    } = useGetJobIdentityMappingsQuery(jobId as string, { skip: !jobId });

    const migrateFileOption = configurationsSetToJob?.["Exclude file older than (UTC)"] ? "excludeFilesOlderThan" : "all";
    const migrationFileOptionExcludeDate = migrateFileOption === "excludeFilesOlderThan" ? dayjs(configurationsSetToJob?.["Exclude file older than (UTC)"]) : dayjs().subtract(1, "day");
    const incrementalSyncSchedule = configurationsSetToJob?.["Incremental sync schedule"] || "";
    const { num: skipFileNum, option: skipFileOption } = parseSkipFiles(skipFilesModified);
    const scheduleConfig = parseIncrementalSchedule(incrementalSyncSchedule);

    const optionForm: BlueXpFormType<OptionsFormType> = useForm({
        exclude_file_patterns: Array.isArray(excludeFilePatterns) ? excludeFilePatterns.join("\n") : "",
        preserve_a_time: preserveATime  === "Enabled",
        sid_mapping: "",
        uid_mapping: "",
        migrate_file_option: migrateFileOption,
        migrate_file_option_exclude: migrationFileOptionExcludeDate,
        skipFileNum: skipFileNum,
        skipFileOption: SKIP_FILE_OPTIONS.find(opt => opt.value === skipFileOption) || SKIP_FILE_OPTIONS[0],
        incremental_sync_schedule: scheduleConfig.schedule,
        incremental_sync_schedule_daily: scheduleConfig.daily,
        incremental_sync_schedule_set: scheduleConfig.set,
        incremental_sync_schedule_weekly: scheduleConfig.weekly,
        incremental_sync_schedule_weekly_day: scheduleConfig.weeklyDay,
        incremental_sync_schedule_weekly_weekday: scheduleConfig.weeklyWeekday,
        incremental_sync_schedule_cron_expression: scheduleConfig.cronExpression,
        incremental_sync_schedule_cron_expression_error: "",
      },
      OPTIONS_FORM
    );

    const mappingStepForm = useFormik<MappingStepFormikFormType>({
      initialValues: {
        selectedMountPathsId: ["dummy-path-id"], // Placeholder, to ensure validation passes
        migrationDetailsTableConfigurationValue: [],
        scheduleTime:  jobScheduledFor && isScheduledForFuture ? "schedule_date" : "start_now",
        scheduledDateTime: jobScheduledFor && isScheduledForFuture ? dayjs.utc(jobScheduledFor) : dayjs.utc().add(MIGRATE_DEFAULT_MINUTES_AHEAD.SCHEDULE_DATE, "minute"),
      },
      validate: validateMappingStepForm,
      onSubmit: () => {},
    });

    const handleSave = async () => {
      if (isModalJobRunning) {
        notify.error("Failed to update migration job configuration.");
        return;
      }
      const formData = optionForm.formState;
      const mappingData = mappingStepForm.values;
      
      if (mappingData.scheduleTime === "schedule_date" && mappingData.scheduledDateTime) {
        const now = dayjs.utc();
        const scheduleDateTime = dayjs.utc(mappingData.scheduledDateTime);
        if (scheduleDateTime.isBefore(now)) {
          notify.error("Scheduled date and time must be in the future");
          return;
        }
      }
      
      let futureScheduleValue = null;
      switch (formData.incremental_sync_schedule) {
        case "Off":
          futureScheduleValue = null;
          break;
        case "cron_expression":
          futureScheduleValue = formData.incremental_sync_schedule_cron_expression;
          break;
        case "schedule":
          if (formData.incremental_sync_schedule_set === "hourly") {
            futureScheduleValue = "0 * * * *";
          }
          else if (formData.incremental_sync_schedule_set === "daily") {
            futureScheduleValue = `${formData.incremental_sync_schedule_daily.minute()} ${formData.incremental_sync_schedule_daily.hour()} * * *`;
          }
          else if (formData.incremental_sync_schedule_set === "weekly") {
            const weekdayValue = formData.incremental_sync_schedule_weekly_weekday?.value ?? 0;
            futureScheduleValue = `0 0 * * ${weekdayValue}`;
          }
          break;
        default:
          futureScheduleValue = null;
      }
      const updateData: any = {
        excludeFilePatterns: formData.exclude_file_patterns || "",
        firstRunAt: mappingData.scheduleTime === "schedule_date" ? mappingData.scheduledDateTime?.toISOString() : null,
        excludeOlderThan: formData.migrate_file_option === "excludeFilesOlderThan" ? formData.migrate_file_option_exclude?.toISOString() : null,
        preserveAccessTime: formData.preserve_a_time,
        skipFile: `${formData.skipFileNum}-${formData.skipFileOption?.value || 'M'}`,
        futureScheduleAt: futureScheduleValue,
      };
      let hasMappingUpdate = false;
      if (jobProtocol === ProtocolType.NFS && formData.upload_uid_mapping) {
        try {
          const base64Data = await convertFileToBase64(
            new Blob([formData.upload_uid_mapping.contents], {
              type: "text/csv;charset=utf-8",
            })
          );
          updateData.gidMapping = base64Data;
          hasMappingUpdate = true;
        } catch (error) {
          notify.error("Failed to process GID/UID mapping file");
          return;
        }
      }
      if (jobProtocol === ProtocolType.SMB && formData.upload_sid_mapping) {
        try {
          const base64Data = await convertFileToBase64(
            new Blob([formData.upload_sid_mapping.contents], {
              type: "text/csv;charset=utf-8",
            })
          );
          updateData.sidMapping = base64Data;
          hasMappingUpdate = true;
        } catch (error) {
          notify.error("Failed to process SID mapping file");
          return;
        }
      }
      onSave(updateData);
    };

    const handleRemoveMappings = async () => {
      try {
        await removeJobIdentityMappings(jobId).unwrap();
        notify.success("Identity mappings removed successfully");
        await refetchMappings();
      } catch (error) {
        const errorMessage = error?.data?.message || "Failed to remove identity mappings";
        notify.error(errorMessage);
      }
    }

    const hasChanges = () => optionForm?.isDirty || mappingStepForm?.dirty;
    const isSaveDisabled = () => {
      return (
        isModalJobRunning ||
        isLoading || 
        !optionForm?.isValid ||
        !mappingStepForm?.isValid ||
        !hasChanges()
      );
    };
    
    return (
      <Box>
        <Box>
          {isModalJobRunning && (
            <div className="bg-red-50 p-3 rounded-lg border-l-4 border-l-red-400 mb-4 shadow-[rgba(0,_0,_0,_0.24)_0px_3px_8px]">
              <p className="text-sm text-red-800 font-medium">
                Job Configuration cannot be edited because the job is running.
              </p>
            </div>
          )}
        </Box>
        <Box className="!bg-white mx-auto shadow-[rgba(0,_0,_0,_0.24)_0px_3px_8px]">
          <Box className="p-6 flex">
            <Box className="w-3/6 flex flex-col gap-8">
              <Box className="flex gap-2 items-center">
                <Toggle 
                  name="preserve_a_time"
                  form={optionForm}
                  value={optionForm.formState.preserve_a_time}
                  toggle={(value) => optionForm.wrappedHandleFormChange('preserve_a_time')(value, null)}
                >
                  Preserve a-time
                </Toggle>
                <Popover placement="right" verticalPlacement="center">
                  In order to preserve access time, toggle it on.
                </Popover>
              </Box>
              <Box>
                <Box className="flex gap-2 items-center mb-1">
                  <Text bold className="!mb-0">Migrate Files</Text>
                  <Popover placement="right" verticalPlacement="center">
                    Migrate all files or exclude files older than a specific date and time
                  </Popover>
                </Box>
                <Box className="flex gap-6">
                  <RadioButton
                    form={optionForm}
                    name="migrate_file_option"
                    value={MIGRATE_OPTION_ENUM.ALL}
                  >
                    All
                  </RadioButton>
                  <RadioButton
                    form={optionForm}
                    name="migrate_file_option"
                    value={MIGRATE_OPTION_ENUM.EXCLUDE}
                  >
                    Exclude file older than (UTC)
                  </RadioButton>
                </Box>
                {optionForm.formState.migrate_file_option ===
                  MIGRATE_OPTION_ENUM.EXCLUDE && (
                  <Box className="flex gap-3 mt-3">
                    <DateTimePickerWrapper form={optionForm} />
                  </Box>
                )}
              </Box>
              <Box className="flex flex-col">
                <Box className="flex gap-2 items-center mb-1">
                  <Text className="!mb-0 font-semibold">Skip files modified in last</Text>
                  <Popover placement="right" verticalPlacement="center">
                    Skip files that are recently modified to avoid the need to
                    migrate multiple times. These will be migrated during
                    cutover.
                  </Popover>
                </Box>
                <Box className="flex gap-2 pr-6">
                  <FormFieldInputNew
                    form={optionForm}
                    name="skipFileNum"
                    placeholder="Number e.g. 10"
                  />
                  <Box className="w-52">
                    <FormFieldSelect
                      name="skipFileOption"
                      form={optionForm}
                      options={SKIP_FILE_OPTIONS}
                    />
                  </Box>
                </Box>
              </Box>
              <IncrementalSyncSchedule variant="edit_config" optionForm={optionForm} />
            </Box>
            <Box className="w-3/6 flex flex-col gap-8">
              <FormFieldTextArea
                form={optionForm}
                placeholder="Excluded Path Patterns"
                name="exclude_file_patterns"
                label="Excluded Path Patterns"
                labelClassName="!mb-0 font-semibold"
                isOptional
                labelChildren={
                  <Popover>Mention File Patterns that should be excluded</Popover>
                }
              />
              <Box className="flex-col gap-2">
                { existingMappings?.items?.data.length > 0 &&
                <Box className="flex gap-2 mb-2">
                  <ExistingIdentityMappings
                    existingMappings={existingMappings}
                    protocol={jobProtocol}
                    jobId={jobId}
                  />
                  { !isModalJobRunning &&
                    <Button
                      variant="text"
                      onClick={handleRemoveMappings}
                      className="ml-auto !p-1 !text-sm !text-red-600"
                    >
                      Remove
                    </Button>
                  } 
                </Box>
                }
                {jobProtocol === ProtocolType.NFS ? (
                  <FormFieldUploadFile
                    form={optionForm}
                    label="Upload GID / UID Mapping"
                    labelClassName="!mb-0 font-semibold"
                    name="upload_uid_mapping"
                    placeholder="Choose a file"
                    labelChildren={
                      <Box className="flex gap-1 items-center">
                        <Button
                          variant="text"
                          onClick={() =>
                            handleDownloadTemplate(
                              () => downloadTemplateApi("gid"),
                              "gid-template.csv"
                            )
                          }
                        >
                          Download Template
                        </Button>
                        <Popover>Download/Upload GID & UID Mapping</Popover>
                      </Box>
                    }
                    errorMessage={
                      optionForm?.formErrors?.["upload_uid_mapping.fileName"]
                    }
                    showError={
                      optionForm?.formErrors?.["upload_uid_mapping.fileName"] ??
                      false
                    }
                  />
                ) : (
                  <FormFieldUploadFile
                    form={optionForm}
                    label="Upload SID Mapping"
                    labelClassName="!mb-0 font-semibold"
                    name="upload_sid_mapping"
                    placeholder="Choose a file"
                    labelChildren={
                      <Box className="flex gap-1 items-center">
                        <Button
                          variant="text"
                          onClick={() =>
                            handleDownloadTemplate(
                              () => downloadTemplateApi("sid"),
                              "sid-template.csv"
                            )
                          }
                        >
                          Download Template
                        </Button>
                        <Popover>Download/Upload SID Mapping</Popover>
                      </Box>
                    }
                    errorMessage={
                      optionForm?.formErrors?.["upload_sid_mapping.fileName"]
                    }
                    showError={
                      optionForm?.formErrors?.["upload_sid_mapping.fileName"] ??
                      false
                    }
                  />
                )}
              </Box>
              <BulkMigrateScheduleComponent mappingStepForm={mappingStepForm} variant="edit_config" />
            </Box>
          </Box>
        </Box>
        <Box className="pt-3 flex gap-3 justify-end mt-3">
            <Button
              onClick={handleSave}
              disabled={isSaveDisabled()}
            >
              {isLoading ? 'Saving...' : 'Save'}
            </Button>
            <Button color="secondary" onClick={() => dispatch(setModalClose())}>
              Close
            </Button>
          </Box>
      </Box>
    );
  };

  const showMigrationJobConfigDetails = () => {
    const handleSaveMigrationConfig = async (updateData: any) => {
      try {
        await updateMigrationConfig({
          jobConfigId: jobId,
          updateData,
        }).unwrap();
        notify.success("Migration job configuration updated successfully.");
        dispatch(setModalClose());
        await refetch();
      } catch (error) {
        notify.error("Failed to update migration job configuration.");
        console.error(error);
      }
    };
    
    dispatch(
      setModalProps({
        isOpen: true,
        modalHeader: "Job Configuration Details",
        modalContent: (
          <Box>
            <BulkMigrateContextWrapper>
              <MigrationConfigDetailsModalContent
                downloadTemplateApi={downloadTemplateApi}
                onSave={handleSaveMigrationConfig}
                isLoading={isUpdatingMigrationConfig}
                jobId={jobId}
              />
            </BulkMigrateContextWrapper>
          </Box>
        ),
        modalStyle: { width: "900px", maxWidth: "90vw" },
        modalFooter: null,
      })
    );
  };

  const DiscoveryConfigDetailsModalContent = ({
    onSave, isLoading 
  }: {
    onSave: (data: any) => void;
    isLoading: boolean;
  }) => {
    const { data: modalJobConfigDetails } = useGetJobConfigDetailsQuery(
      { jobConfigId: jobId },
      { skip: !jobId }
    );
    const isModalJobRunning = useMemo(
      () => isJobCurrentlyRunning(modalJobConfigDetails),
      [modalJobConfigDetails?.jobRuns]
    );

    const bulkDiscoveryForm: BlueXpFormType<bulkDiscoveryFormType> = useForm({
      excludeFilePatterns: Array.isArray(excludeFilePatterns) ? excludeFilePatterns.join("\n") : "",
      scheduleTime: jobScheduledFor && isScheduledForFuture ? "schedule_date" : "start_now",
      firstRunAt: jobScheduledFor && isScheduledForFuture ? dayjs.utc(jobScheduledFor) : dayjs.utc().add(DISCOVERY_DEFAULT_MINUTES_AHEAD.SCHEDULE_DATE, "minute"),
      protocol: { label: jobProtocol, value: jobProtocol }
    },
      BULK_DISCOVERY_FORM_SCHEMA
    );

    const handleSave = () => {
      if (isJobCurrentlyRunning()) {
        notify.error("Failed to update discovery job configuration.");
        return;
      }
      const formData = bulkDiscoveryForm.formState;

      if (formData.scheduleTime === "schedule_date" && formData.firstRunAt) {
        const now = dayjs.utc();
        const scheduleDateTime = dayjs.utc(formData.firstRunAt);
        if (scheduleDateTime.isBefore(now)) {
          notify.error("Scheduled date and time must be in the future");
          return;
        }
      }
      
      const updateData = {
        excludeFilePatterns: formData.excludeFilePatterns || "",
        firstRunAt: formData.scheduleTime === "schedule_date" ? formData.firstRunAt : null,
      };
      onSave(updateData);
    };
    
    const isSaveDisabled = () => {
      return (
        isModalJobRunning || 
        isLoading || 
        !bulkDiscoveryForm?.isValid ||
        !bulkDiscoveryForm?.isDirty
      );
    };

    return (
      <Box>
        <Box>
          {isModalJobRunning && (
            <div className="bg-red-50 p-3 rounded-lg border-l-4 border-l-red-400 mb-4 shadow-[rgba(0,_0,_0,_0.24)_0px_3px_8px]">
              <p className="text-sm text-red-800 font-medium">
                Job Configuration cannot be edited because the job is running.
              </p>
            </div>
          )}
        </Box>
        <Box className="!bg-white mx-auto shadow-[rgba(0,_0,_0,_0.24)_0px_3px_8px]">
          <Box className="p-6 flex gap-10">
            <Box className="w-3/6 flex flex-col">
              <FormFieldTextArea
                form={bulkDiscoveryForm}
                placeholder="Excluded Path Patterns"
                name="excludeFilePatterns"
                label="Excluded Path Patterns"
                labelClassName="!mb-0 font-semibold"
                isOptional
                labelChildren={
                  <Popover>Mention file patterns that should be excluded</Popover>
                }
              />
            </Box>
            <Box className="w-3/6 flex flex-col gap-8">
              <ScheduleComponent bulkDiscoveryForm={bulkDiscoveryForm} variant="edit_config" />
            </Box>
          </Box>
        </Box>
          <Box className="pt-3 flex gap-3 justify-end mt-3">
            <Button
              onClick={handleSave}
              disabled={isSaveDisabled()}
            >
              {isLoading ? 'Saving...' : 'Save'}
            </Button>
            <Button color="secondary" onClick={() => dispatch(setModalClose())}>
              Close
            </Button>
          </Box>
      </Box>
    )
  };

  const showDiscoveryJobConfigDetails = () => {
    const handleSaveDiscoveryConfig = async (updateData: any) => {
      try {
        await updateDiscoveryConfig({
          jobConfigId: jobId,
          updateData,
        }).unwrap();
        notify.success("Discovery job configuration updated successfully.");
        dispatch(setModalClose());
        await refetch();
      } catch (error) {
        notify.error("Failed to update discovery job configuration.");
        console.error(error);
      }
    };

    dispatch(
      setModalProps({
        isOpen: true,
        modalHeader: "Job Configuration Details",
        modalContent: (
          <Box>
            <DiscoveryConfigDetailsModalContent 
              onSave={handleSaveDiscoveryConfig}
              isLoading={isUpdatingDiscoveryConfig}
            />
          </Box>
        ),
        modalStyle: { width: "900px", maxWidth: "90vw" },
        modalFooter: null,
      })
    );
  };

  const showCutoverJobConfigDetails = () => {
    dispatch(
      setModalProps({
        isOpen: true,
        modalHeader: "Job Configuration Details",
        modalContent: (
          <Box>
            <Box className="!bg-white mx-auto shadow-[rgba(0,_0,_0,_0.24)_0px_3px_8px]">
              <Box className="p-6 flex gap-8">
                <Box className="w-3/6 flex flex-col gap-8">
                  <Box>
                    <Text className="!mb-0 font-semibold">Preserve a-time:</Text>
                    <Text>{preserveATime}</Text>
                  </Box>
                  <Box>
                    <Text className="!mb-0 font-semibold">Exclude Files Older Than:</Text>
                    <Text>{skipFilesModified}</Text>
                  </Box>
                </Box>  
                <Box className="w-3/6 flex flex-col gap-8">
                  <Box>
                    <Text className="!mb-0 font-semibold">Excluded Path Patterns:</Text>
                    <Text className="whitespace-pre-wrap">{excludeFilePatterns.join("\n")}</Text>
                  </Box>
                </Box>
              </Box>
            </Box> 
            <Box className="pt-3 flex justify-end mt-3">
              <Button color="secondary" onClick={() => dispatch(setModalClose())}>
                Close
              </Button>
            </Box>
          </Box>
        ),
        modalStyle: { width: "900px", maxWidth: "90vw" },
        modalFooter: null,
      })
    );
  };

  const showEditJobConfigDetails = () => {
    if(jobConfigDetails?.jobType===JOBS_TYPE.MIGRATE) {
      return showMigrationJobConfigDetails();
    }
    else if(jobConfigDetails?.jobType===JOBS_TYPE.DISCOVERY) {
      return showDiscoveryJobConfigDetails();
    }
    else{
      return showCutoverJobConfigDetails();
    }
  };

  return (
    <Box className="flex flex-col gap-4">
      {openConfirmation && (
        <CutoverConfirmationModal
          jobRunId={selectedJobRunId}
          closeConfirmationBox={closeConfirmationBox}
        />
      )}
      <Breadcrumbs className="mb-4" key={jobId}>
        <Button onClick={() => navigate("/jobs-list")} variant="text">
          Jobs
        </Button>
        <Box>Job Details</Box>
      </Breadcrumbs>
      <Box className="flex flex-col gap-2">
        <Box className="flex justify-between">
          <TitleWithLastRefreshedDate
            title={
              <Heading level="16" bold className="flex">
                {jobConfigDetails?.jobType === JOBS_TYPE.DISCOVERY
                  ? "Summary of Last Run"
                  : "Total of All Runs"}
              </Heading>
            }
            date={latestJobRun?.lastRefreshed}
          />

          <PermissionAuth permissionName={USER_PERMISSION_TYPE_ENUM.ManageJob}>
            <Box className="flex flex-row gap-6 justify-end">
              <Button
                onClick={showEditJobConfigDetails}
                disabled={!jobId}
              >
                {jobConfigDetails?.jobType === JOBS_TYPE.CUT_OVER
                  ? "View Configuration"
                  : "View / Edit Configuration"}
              </Button>
              <Button
                onClick={() => adhocRun(jobId, true)}
                disabled={
                  !jobId ||
                  jobConfigDetails?.status === JOB_CONFIG_STATUS_ENUM.INACTIVE
                }
              >
                Adhoc Run
              </Button>
            </Box>
          </PermissionAuth>
        </Box>
        <JobHeader jobConfigDetails={jobConfigDetails} />
      </Box>
      <Box className="flex gap-6 items-stretch">
        <Box className="grow basis-1/2">
          <JobDescription
            id={jobId}
            source={jobConfigDetails?.sourceServer}
            destination={jobConfigDetails?.destinationServer}
          />
        </Box>
        <Box className="grow basis-1/2 items-stretch">
          <JobErrors latestJobRunId={latestJobRunId} />
        </Box>
      </Box>
      <TableWrapper
        tableStateProps={tableStateProps}
        isLoading={isLoading}
        rowMenu={rowMenu}
        label="Run History"
        content={errorLogContent}
        isTogglingColumns={true}
        originalColumns={JOB_RUN_LIST_COLUMN_DEFS}
        refetchTableData={refetch}
        isRefreshing={isFetching}
      />
    </Box>
  );
};

export default JobDetails;
