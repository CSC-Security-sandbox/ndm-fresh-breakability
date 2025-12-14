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
  useLazyGetJobIdentityMappingsQuery,
  useUpdateDiscoveryJobConfigMutation,
  useUpdateMigrationJobConfigMutation,
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
import RadioButtonGroup from "@components/radio-button/RadioButtonGroup";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import TitleWithLastRefreshedDate from "@components/TitleWithLastRefreshedDate/TitleWithLastRefreshedDate";
import useAdhocRun from "@hooks/useAdhocRun";
import { useLatestJobRun } from "@/hooks/useLatestJobRun";
import { getActionMenu, getReportActions } from "@modules/jobs/job-run-list/run.utils";
import { ErrorLogActionButton } from "@modules/jobs/job-task-errors/components/ErrorLogActionButton";
import {
  DOWNLOAD_BULK_ERROR_REPORT,
  GENERATE_BULK_ERROR_REPORT,
} from "@modules/jobs/job-task-errors/jobTaskErrors.constant";
import JobDescription from "@modules/jobs/jobs-list/job-details/components/JobDescription";
import JobErrors from "@modules/jobs/jobs-list/job-details/components/JobErrors";
import JobHeader from "@modules/jobs/jobs-list/job-details/components/JobHeader";
import { JOB_RUN_LIST_COLUMN_DEFS } from "@modules/jobs/jobs-list/job-details/job-details.constants";
import {
  handleDownloadCocReport,
  handleDownloadErrorsLogs,
  handleDownloadReport,
} from "@modules/jobs/jobs.utils";
import ScheduleComponent from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/components/ScheduleComponent";
import {
  BULK_DISCOVERY_FORM_SCHEMA,
  DEFAULT_MINUTES_AHEAD as DISCOVERY_DEFAULT_MINUTES_AHEAD,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/bulk-discover.constant";
import { bulkDiscoveryFormType } from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/bulk-discovery.interface";
import {
  SKIP_FILE_OPTIONS,
  OPTIONS_FORM,
  MIGRATE_OPTION_ENUM,
  DEFAULT_MINUTES_AHEAD  as MIGRATE_DEFAULT_MINUTES_AHEAD
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import { MappingStepFormikFormType, OptionsFormType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import { 
  handleDownloadTemplate, 
  validateMappingStepForm 
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";
import DateTimePickerWrapper from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/MigrateFileOption/ExcludeDateTimePickerWrapper";
import {
  INCREMENTAL_SYNC_SCHEDULE_ENUM,
  INCREMENTAL_SYNC_SCHEDULE_OPTIONS,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/IncrementalSyncSchedule/incremental-sync-schedule.constants";
import ScheduleOptions from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/ScheduleOptions/ScheduleOptions";
import BulkMigrateScheduleComponent from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/BulkMigrateScheduleComponent";
import BulkMigrateContextProvider from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { withBulkMigrateCreateForm } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/withBulkMigrateCreateForm";
import {
  Breadcrumbs,
  Button,
  FormFieldInputNew,
  FormFieldSelect,
  FormFieldTextArea,
  FormFieldUploadFile,
  Heading,
  Popover,
  RadioButton,
  Text,
  Toggle,
  useForm,
} from "@netapp/bxp-design-system-react";
import { WEEKDAY_OPTIONS } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import { MobileTimePicker } from "@mui/x-date-pickers/MobileTimePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch } from "react-redux";
import { setModalClose, setModalProps } from "@store/reducer/commonComponentSlice";
import { isValidCron } from "cron-validator";
import cronstrue from "cronstrue";
import { useFormik } from "formik";
import dayjs from "dayjs";
import ExistingIdentityMappings from "@/hooks/useExistingIdentityMappings";

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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showGeneratingReportBtn, setShowGeneratingReportBtn] =
    useState<Record<string, boolean>>();
  const [isJobRunning, setIsJobRunning] = useState<boolean>(false);
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
  const [shouldFetchMappings, setShouldFetchMappings] = useState(false);
  const [getJobIdentityMappings, { data: existingMappings, isLoading: isMappingsLoading }] = useLazyGetJobIdentityMappingsQuery();
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

  useEffect(() => {
    if (!isModalOpen || !jobId) return;
    const fastCheckInterval = setInterval(() => {
      refetch();
    }, 2000);
    return () => clearInterval(fastCheckInterval);
  }, [isModalOpen, jobId, refetch]);

  useEffect(() => {
    if (shouldFetchMappings || jobId) {
      getJobIdentityMappings(jobId);
      setShouldFetchMappings(false);
    }
  }, [shouldFetchMappings, jobId, getJobIdentityMappings]);

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

  const parseSkipFiles = (skipValue: string) => {
    if (skipValue === "-") return { num: 15, option: "M" };
    
    const match = skipValue.match(/^(\d+)-?(Mins?|Hrs?|Days?)$/);
    if (match) {
      const num = parseInt(match[1]);
      const unit = match[2];
      let option = "M";
      if (unit.startsWith("Hr")) option = "H";
      else if (unit.startsWith("Day")) option = "D";
      
      return { num, option };
    }
    return { num: 15, option: "M" };
  };

  const parseIncrementalSchedule = (schedule: string) => {
    if (!schedule || schedule === "Off") {
      return {
        schedule: "Off",
        set: "hourly",
        daily: dayjs().hour(10).minute(30),
        weekly: "day",
        weeklyDay: { label: "1", value: 1 },
        weeklyWeekday: { label: "Sunday", value: 0 },
        cronExpression: "* * * * *"
      };
    }
    
    // Handle cron expressions
    if (schedule.includes("*") || /^\d+\s+\d+\s+\d+\s+\d+\s+\d+$/.test(schedule.trim()) || /^[\d\*\-\,\/\s]+$/.test(schedule.trim())) {
      return {
        schedule: "cron_expression",
        set: "hourly",
        daily: dayjs().hour(10).minute(30),
        weekly: "day",
        weeklyDay: { label: "1", value: 1 },
        weeklyWeekday: { label: "Sunday", value: 0 },
        cronExpression: schedule
      };
    }
    
    // Try to parse as a datetime string (ISO format or other recognizable formats)
    if (schedule.includes('T') || schedule.includes('-') || schedule.includes('/') || schedule.includes(':')) {
      const scheduleDate = dayjs(schedule);
      if (scheduleDate.isValid()) {
        return {
          schedule: "schedule",
          set: "daily", // Default to daily if we have a specific datetime
          daily: scheduleDate,
          weekly: "day",
          weeklyDay: { label: scheduleDate.date().toString(), value: scheduleDate.date() },
          weeklyWeekday: { label: scheduleDate.format('dddd'), value: scheduleDate.day() },
          cronExpression: "* * * * *"
        };
      }
    }
    
    // Handle human-readable schedule formats (like "hourly", "daily", "weekly")
    const lowerSchedule = schedule.toLowerCase();
    if (lowerSchedule.includes('hour')) {
      return {
        schedule: "schedule",
        set: "hourly",
        daily: dayjs().hour(10).minute(30),
        weekly: "day",
        weeklyDay: { label: "1", value: 1 },
        weeklyWeekday: { label: "Sunday", value: 0 },
        cronExpression: "* * * * *"
      };
    }
    
    if (lowerSchedule.includes('day') || lowerSchedule.includes('daily')) {
      return {
        schedule: "schedule",
        set: "daily",
        daily: dayjs().hour(10).minute(30),
        weekly: "day",
        weeklyDay: { label: "1", value: 1 },
        weeklyWeekday: { label: "Sunday", value: 0 },
        cronExpression: "* * * * *"
      };
    }
    
    if (lowerSchedule.includes('week')) {
      return {
        schedule: "schedule",
        set: "weekly",
        daily: dayjs().hour(10).minute(30),
        weekly: "day",
        weeklyDay: { label: "1", value: 1 },
        weeklyWeekday: { label: "Sunday", value: 0 },
        cronExpression: "* * * * *"
      };
    }

    // Default to schedule type for any other formats
    return {
      schedule: "schedule",
      set: "hourly",
      daily: dayjs().hour(10).minute(30),
      weekly: "day",
      weeklyDay: { label: "1", value: 1 },
      weeklyWeekday: { label: "Sunday", value: 0 },
      cronExpression: "* * * * *"
    };
  }

  const isJobCurrentlyRunning = () => {
    if (!jobConfigDetails?.jobRuns || jobConfigDetails.jobRuns.length === 0) {
      return false;
    }
    const activeStatuses = [
      JOB_STATUS_TYPE_ENUM.RUNNING,
      JOB_STATUS_TYPE_ENUM.PENDING,
      JOB_STATUS_TYPE_ENUM.PAUSING,
      JOB_STATUS_TYPE_ENUM.PAUSED,
      JOB_STATUS_TYPE_ENUM.READY,
      JOB_STATUS_TYPE_ENUM.STOPPING,
    ];
    return jobConfigDetails.jobRuns.some(jobRun => 
      activeStatuses.includes(jobRun.status)
    );
  };

  // common configurations
  const configurationsSetToJob = jobConfigDetails?.configurationsSetToJob;
  const excludeFilePatterns = configurationsSetToJob?.["Excluded Path Patterns"];
  const jobScheduledFor = configurationsSetToJob?.["Job Scheduled For"];
  const isScheduledForFuture = jobScheduledFor ? dayjs.utc(jobScheduledFor).isAfter(dayjs.utc()) : false;
  const jobProtocol = jobConfigDetails?.sourceServer?.protocol;
  const preserveATime = configurationsSetToJob?.["Preserve a-time"] === "Enabled";
  const skipFilesModified = configurationsSetToJob?.["Skip Files modified in last"] || "-";

  const MigrationConfigDetailsModalContent = ({
    downloadTemplateApi, onSave, isLoading 
  }: {
    downloadTemplateApi: DownloadTemplateTrigger;
    onSave: (data: any) => void;
    isLoading: boolean;
  }) => {
    const migrateFileOption = configurationsSetToJob?.["Exclude file older than (UTC)"] ? "excludeFilesOlderThan" : "all";
    const migrationFileOptionExcludeDate = migrateFileOption === "excludeFilesOlderThan" ? dayjs(configurationsSetToJob?.["Exclude file older than (UTC)"]) : dayjs().subtract(1, "day");
    const incrementalSyncSchedule = configurationsSetToJob?.["Incremental sync schedule"] || "";
    const { num: skipFileNum, option: skipFileOption } = parseSkipFiles(skipFilesModified);
    const scheduleConfig = parseIncrementalSchedule(incrementalSyncSchedule);

    const optionForm: BlueXpFormType<OptionsFormType> = useForm({
        exclude_file_patterns: Array.isArray(excludeFilePatterns) ? excludeFilePatterns.join("\n") : excludeFilePatterns,
        preserve_a_time: preserveATime,
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
        selectedMountPathsId: [],
        migrationDetailsTableConfigurationValue: [],
        scheduleTime:  jobScheduledFor && isScheduledForFuture ? "schedule_date" : "start_now",
        scheduledDateTime: jobScheduledFor && isScheduledForFuture ? dayjs.utc(jobScheduledFor) : dayjs.utc().add(MIGRATE_DEFAULT_MINUTES_AHEAD.SCHEDULE_DATE, "minute"),
      },
      validate: validateMappingStepForm,
      onSubmit: () => {},
    });

    const [cronErrorMessage, setCronErrorMessage] = useState<string>();
    const { incremental_sync_schedule_cron_expression } = optionForm.formState;
    const handleSave = async () => {
      if (isJobCurrentlyRunning()) {
        notify.error("Failed to update migration job configuration.");
        return;
      }
      const formData = optionForm.formState;
      const mappingData = mappingStepForm.values;
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
  
    const cronString = useMemo(() => {
      setCronErrorMessage("");
      if (!incremental_sync_schedule_cron_expression) {
        optionForm.formState.incremental_sync_schedule_cron_expression_error = "";
        return "";
      }
      try {
        optionForm.formState.incremental_sync_schedule_cron_expression_error = "";
        if (!isValidCron(incremental_sync_schedule_cron_expression)) {
          throw new Error("Invalid cron expression");
        }
        const readable = cronstrue.toString(
          incremental_sync_schedule_cron_expression
        );
        return readable;
      } catch (error) {
        setCronErrorMessage(
          (error as Error).message || "Failed to validate cron expression"
        );
        optionForm.formState.incremental_sync_schedule_cron_expression_error = (
          error as Error
        ).message;
        return "";
      }
    }, [incremental_sync_schedule_cron_expression]);

    const hasChanges = () => optionForm?.isDirty || mappingStepForm?.dirty;
    const isSaveDisabled = () => {
      return (
        isJobRunning || 
        isLoading || 
        !optionForm?.isValid ||
        !mappingStepForm?.isValid ||
        !hasChanges()
      );
    };
    
    return (
      <Box className="!bg-white mx-auto shadow-[rgba(0,_0,_0,_0.24)_0px_3px_8px]">
        <Box className="p-6 flex">
          <Box className="w-3/6 flex flex-col gap-8">
            <Box className="flex gap-2 items-center">
              <Toggle name="preserve_a_time" form={optionForm}>
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
            <Box>
            <Box className="flex gap-2 items-center mb-1">
              <Text bold className="!mb-0">Incremental sync schedule</Text>
              <Popover placement="right" verticalPlacement="center">
                Option to turn on incremental migrations, either by a schedule or with
                cron expression.
              </Popover>
            </Box>
            <Box className="flex gap-6">
              <RadioButtonGroup
                options={INCREMENTAL_SYNC_SCHEDULE_OPTIONS}
                form={optionForm}
                name="incremental_sync_schedule"
              />
            </Box>
            {optionForm.formState.incremental_sync_schedule ===
              INCREMENTAL_SYNC_SCHEDULE_ENUM.SCHEDULE && (
              <Box className="flex mt-3">
                <Box className="w-full">
                  <Text className="flex gap-6">
                    <RadioButton
                      form={optionForm}
                      name="incremental_sync_schedule_set"
                      value="hourly"
                    >
                      Hourly
                    </RadioButton>
                    <RadioButton
                      form={optionForm}
                      name="incremental_sync_schedule_set"
                      value="daily"
                    >
                      Daily
                    </RadioButton>
                    <RadioButton
                      form={optionForm}
                      name="incremental_sync_schedule_set"
                      value="weekly"
                    >
                      Weekly
                    </RadioButton>
                  </Text>
                  {optionForm.formState.incremental_sync_schedule_set === "daily" && (
                    <Box className="flex flex-col gap-3 mt-3">
                      <Text>Schedule Daily Start time</Text>
                      <LocalizationProvider dateAdapter={AdapterDayjs}>
                        <MobileTimePicker
                          openTo="hours"
                          className="w-52"
                          value={optionForm.formState.incremental_sync_schedule_daily}
                          onChange={(newValue) => {
                            optionForm.wrappedHandleFormChange("incremental_sync_schedule_daily")(newValue, null);
                          }}
                          slotProps={{
                            dialog: { sx: { zIndex: 200000010 } },
                          }}
                        />
                      </LocalizationProvider>
                    </Box>
                  )}
                  {optionForm.formState.incremental_sync_schedule_set === "weekly" && (
                    <Box className="flex flex-col mt-3">
                      <Text>Select day of the week:</Text>
                      <Box className="flex gap-2">
                        <FormFieldSelect
                          name="incremental_sync_schedule_weekly_weekday"
                          form={optionForm}
                          options={WEEKDAY_OPTIONS}
                          placeholder="Select weekday"
                          style={{ width: 150 }}
                        />
                      </Box>
                    </Box>
                  )}
                </Box>
              </Box>
            )}
            {optionForm.formState.incremental_sync_schedule ===
              INCREMENTAL_SYNC_SCHEDULE_ENUM.CRON_EXPRESSION && (
              <Box className="flex flex-col mt-3 pr-6">
                <FormFieldInputNew
                  form={optionForm}
                  name="incremental_sync_schedule_cron_expression"
                  placeholder="* * * * *"
                  label="Cron Expression"
                  showError={
                    !optionForm.formState.incremental_sync_schedule_cron_expression ||
                    cronErrorMessage
                  }
                  errorMessage={
                    cronErrorMessage?.replaceAll("Error: ", "") ||
                    "This field is required"
                  }
                />
                {!cronErrorMessage && <Text className="-mt-4">{cronString}</Text>}
              </Box>
            )}
          </Box>
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
            <Box className="flex-col gap-2 mb-2">
              { existingMappings?.items?.data.length > 0 &&
              <ExistingIdentityMappings
                existingMappings={existingMappings}
                protocol={jobProtocol}
              />
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
        <Box className="p-6 pt-0 flex gap-3 justify-end">
          <Button
            onClick={handleSave}
            disabled={isSaveDisabled()}
          >
            {isLoading ? 'Saving...' : 'Save'}
          </Button>
          <Button onClick={() => dispatch(setModalClose())} variant="secondary">
            Close
          </Button>
        </Box>
      </Box>
    );
  };

  const showMigrationJobConfigDetails = () => {
    setIsModalOpen(true);
    const handleSaveMigrationConfig = async (updateData: any) => {
      try {
        await updateMigrationConfig({
          jobConfigId: jobId,
          updateData,
        }).unwrap();
        notify.success("Migration job configuration updated successfully.");
        dispatch(setModalClose());
        setIsModalOpen(false);
        await refetch();
      } catch (error) {
        notify.error("Failed to update migration job configuration.");
        console.error(error);
      }
    };
    setShouldFetchMappings(true);
    
    dispatch(
      setModalProps({
        isOpen: true,
        modalHeader: "Job Configuration Details",
        modalContent: (
          <Box>
            {isJobRunning && (
              <div className="bg-red-50 p-3 rounded-lg border-l-4 border-l-red-400 mb-4 shadow-[rgba(0,_0,_0,_0.24)_0px_3px_8px]">
                <p className="text-sm text-red-800 font-medium">
                  Job Configuration cannot be edited because the job is running.
                </p>
              </div>
            )}
            <BulkMigrateContextWrapper>
              <MigrationConfigDetailsModalContent
                downloadTemplateApi={downloadTemplateApi}
                onSave={handleSaveMigrationConfig}
                isLoading={isUpdatingMigrationConfig}
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
    const bulkDiscoveryForm: BlueXpFormType<bulkDiscoveryFormType> = useForm({
      excludeFilePatterns: Array.isArray(excludeFilePatterns) ? excludeFilePatterns.join("\n") : "",
      scheduleTime: jobScheduledFor && isScheduledForFuture ? "schedule_date" : "start_now",
      firstRunAt: jobScheduledFor && isScheduledForFuture ? dayjs.utc(jobScheduledFor) : dayjs.utc().add(DISCOVERY_DEFAULT_MINUTES_AHEAD.SCHEDULE_DATE, "minute"),
      protocol: { label: jobProtocol, value: jobProtocol }
    },
      BULK_DISCOVERY_FORM_SCHEMA
    );

    const handleSave = () => {
      if (isJobRunning) {
        notify.error("Failed to update discovery job configuration.");
        return;
      }
      const formData = bulkDiscoveryForm.formState;
      const updateData = {
        excludeFilePatterns: formData.excludeFilePatterns || "",
        firstRunAt: formData.scheduleTime === "schedule_date" ? formData.firstRunAt : null,
      };
      onSave(updateData);
    };
    
    const isSaveDisabled = () => {
      return (
        isJobRunning || 
        isLoading || 
        !bulkDiscoveryForm?.isValid ||
        !bulkDiscoveryForm?.isDirty
      );
    };

    return (
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
        <Box className="p-6 pt-0 flex gap-3 justify-end">
          <Button
            onClick={handleSave}
            disabled={isSaveDisabled()}
          >
            {isLoading ? 'Saving...' : 'Save'}
          </Button>
          <Button onClick={() => dispatch(setModalClose())} variant="secondary">
            Close
          </Button>
        </Box>
      </Box>
    )
  };

  const showDiscoveryJobConfigDetails = () => {
    setIsModalOpen(true);
    const isRunning = isJobRunning;
    const handleSaveDiscoveryConfig = async (updateData: any) => {
      try {
        await updateDiscoveryConfig({
          jobConfigId: jobId,
          updateData,
        }).unwrap();
        notify.success("Discovery job configuration updated successfully.");
        dispatch(setModalClose());
        setIsModalOpen(false);
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
            { isRunning && (
              <div className="bg-red-50 p-3 rounded-lg border-l-4 border-l-red-400 mb-4 shadow-[rgba(0,_0,_0,_0.24)_0px_3px_8px]">
                <p className="text-sm text-red-800 font-medium">
                  Job Configuration cannot be edited because the job is running.
                </p>
              </div>
            )}
            <DiscoveryConfigDetailsModalContent 
              onSave={handleSaveDiscoveryConfig}
              isLoading={isUpdatingDiscoveryConfig}
            />
          </Box>
        ),
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
          <Box className="!bg-white mx-auto shadow-[rgba(0,_0,_0,_0.24)_0px_3px_8px]">
            <Box className="p-6 flex gap-8">
              <Box className="w-3/6 flex flex-col gap-8">
                <Box>
                  <Text className="font-semibold">Preserve a-time:</Text>
                  <Text>{preserveATime}</Text>
                </Box>
                <Box>
                  <Text className="font-semibold">Exclude Files Older Than:</Text>
                  <Text>{skipFilesModified}</Text>
                </Box>
              </Box>  
              <Box className="w-3/6 flex flex-col gap-8">
                <Box>
                  <Text className="font-semibold">Excluded Path Patterns:</Text>
                  <Text>{excludeFilePatterns.join("\n")}</Text>
                </Box>
              </Box>
            </Box>
          </Box>
        ),
        modalFooter: (
          <Button onClick={() => dispatch(setModalClose())}>Close</Button>
        ),
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
