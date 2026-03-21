import {
  GetActionMenuPropType,
  JOB_ACTION_STATUS_ENUM,
  JOB_STATUS_TYPE_ENUM,
  JobRunApiType,
  JOBS_TYPE,
  REPORT_TYPES_ENUM,
} from "@/types/app.type";

export const getJobRunListFlaternList = (list: JobRunApiType[]) => {
  return list.map((row) => ({
    ...row,
    sourceServerName: row.sourceServer.serverName,
    sourceServerProtocol: row.sourceServer.protocol,
    destinationServerName: row.destinationServer?.serverName || "",
  }));
};

export const getActionMenu = ({
  jobRunId,
  status,
  handleUpdateStatus,
  isDisabled,
  adhocRun,
}: GetActionMenuPropType) => {
  switch (status) {
    case JOB_STATUS_TYPE_ENUM.RUNNING:
      return [
        {
          label: "Pause",
          onClick: () =>
            handleUpdateStatus(jobRunId, JOB_ACTION_STATUS_ENUM.PAUSE),
          disabled: isDisabled,
        },
        {
          label: "Stop",
          onClick: () =>
            handleUpdateStatus(jobRunId, JOB_ACTION_STATUS_ENUM.STOP),
          disabled: isDisabled,
        },
      ];
    case JOB_STATUS_TYPE_ENUM.PAUSED:
      return [
        {
          label: "Resume",
          onClick: () =>
            handleUpdateStatus(jobRunId, JOB_ACTION_STATUS_ENUM.RESUME),
          disabled: isDisabled,
        },
        {
          label: "Stop",
          onClick: () =>
            handleUpdateStatus(jobRunId, JOB_ACTION_STATUS_ENUM.STOP),
          disabled: isDisabled,
        },
      ];
    case JOB_STATUS_TYPE_ENUM.READY:
      return [
        {
          label: "Stop",
          onClick: () =>
            handleUpdateStatus(jobRunId, JOB_ACTION_STATUS_ENUM.STOP),
          disabled: isDisabled,
        },
      ];
    default:
      return [];
  }
};

// This function is to get buttons / rowMenu for Reports i.e. Discovery / CoC Report
export const getReportActions = (
  row: JobRunApiType,
  handleDownloadReport: (
    downloadReports: (arg: any) => void,
    jobRunId: string,
    reportType: REPORT_TYPES_ENUM,
    fileType: string
  ) => void,
  handleDownloadCocReport: (
    prepareDownloadApi: (arg: any) => void,
    jobRunId: string,
    reportType?: string
  ) => void,
  downloadReportApi: (arg: any) => void,
  getPdfReportApi: (arg: any) => void,
  prepareDownloadApi: (arg: any) => void,
  type: "rowMenu" | "button" = "rowMenu"
) => {
  const isReportReady =
    [
      JOB_STATUS_TYPE_ENUM.COMPLETED,
      JOB_STATUS_TYPE_ENUM.BLOCKED,
      JOB_STATUS_TYPE_ENUM.APPROVED,
      JOB_STATUS_TYPE_ENUM.REJECTED,
      JOB_STATUS_TYPE_ENUM.ERRORED,
      JOB_STATUS_TYPE_ENUM.FAILED,
    ].includes(row.status) && row.isReportReady;

  switch (row.jobType) {
    case JOBS_TYPE.DISCOVERY:
      return [
        {
          label:
            type === "rowMenu"
              ? "Download Discovery Report as CSV"
              : "Download as CSV",
          onClick: () => {
            handleDownloadReport(
              downloadReportApi,
              row.jobRunId,
              REPORT_TYPES_ENUM.DISCOVERY,
              "CSV"
            );
          },
          disabled: !isReportReady,
        },
        {
          label:
            type === "rowMenu"
              ? "Download Discovery Report as PDF"
              : "Download as PDF",
          onClick: () => {
            handleDownloadReport(
              getPdfReportApi,
              row.jobRunId,
              REPORT_TYPES_ENUM.DISCOVERY,
              "PDF"
            );
          },
          disabled: !isReportReady,
        },
      ];
    case JOBS_TYPE.MIGRATE:
      return [
        {
          label: type === "rowMenu" ? "Download CoC Report" : "CoC Report",
          onClick: () => {
            handleDownloadCocReport(prepareDownloadApi, row?.jobRunId);
          },
          disabled: !isReportReady,
        },
      ];
    case JOBS_TYPE.CUT_OVER:
      return [
        {
          label: type === "rowMenu" ? "Download CoC Report" : "CoC Report",
          onClick: () => {
            handleDownloadCocReport(prepareDownloadApi, row?.jobRunId);
          },
          disabled: !isReportReady,
        },
        {
          label: type === "rowMenu" ? "Download Jobs Report" : "Jobs Report",
          onClick: () => {
            handleDownloadReport(
              getPdfReportApi,
              row.jobRunId,
              REPORT_TYPES_ENUM.JOBS_REPORT,
              "PDF"
            );
          },
          disabled: !isReportReady,
        },
      ];
    default:
      return [];
  }
};
