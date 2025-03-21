import {
  GetActionMenuPropType,
  JOB_ACTION_STATUS_ENUM,
  JOB_STATUS_TYPE_ENUM,
  JobRunApiType,
  JOBS_TYPE,
  ReportENUM,
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
    case JOB_STATUS_TYPE_ENUM.STOPPED:
    case JOB_STATUS_TYPE_ENUM.ERRORED:
      return [
        {
          label: "Start",
          onClick: adhocRun,
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
    downloadReports: Function,
    jobRunId: string,
    reportType: ReportENUM,
    fileType: string
  ) => void,
  downloadReportApi: Function,
  getPdfReportApi: Function,
  type: "rowMenu" | "button" = "rowMenu"
) => {
  const isReportReady =
    (row.status === JOB_STATUS_TYPE_ENUM.COMPLETED ||
      row.status === JOB_STATUS_TYPE_ENUM.BLOCKED) &&
    row.isReportReady;
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
              ReportENUM.DISCOVERY,
              "csv"
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
              ReportENUM.DISCOVERY,
              "pdf"
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
            handleDownloadReport(
              downloadReportApi,
              row.jobRunId,
              ReportENUM.COC,
              "csv"
            );
          },
          disabled: !isReportReady,
        },
      ];
    case JOBS_TYPE.CUT_OVER:
      return [
        {
          label: type === "rowMenu" ? "Download CoC Report" : "CoC Report",
          onClick: () => {
            handleDownloadReport(
              downloadReportApi,
              row.jobRunId,
              ReportENUM.COC,
              "csv"
            );
          },
          disabled: !isReportReady,
        },
        {
          label: type === "rowMenu" ? "Download Jobs Report" : "Jobs Report",
          onClick: () => {
            handleDownloadReport(
              getPdfReportApi,
              row.jobRunId,
              ReportENUM.JOBS_REPORT,
              "pdf"
            );
          },
          disabled: !isReportReady,
        },
      ];
    default:
      return [];
  }
};
