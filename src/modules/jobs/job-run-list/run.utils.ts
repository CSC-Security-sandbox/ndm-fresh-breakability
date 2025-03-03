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
}: GetActionMenuPropType) => {
  switch (status) {
    case JOB_STATUS_TYPE_ENUM.RUNNING:
    case JOB_STATUS_TYPE_ENUM.READY:
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
    row.status === JOB_STATUS_TYPE_ENUM.COMPLETED && row.isReportReady;
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
    case JOBS_TYPE.CUT_OVER:
      return [
        {
          label:
            type === "rowMenu"
              ? "Download CoC Report as CSV"
              : "Download as CSV",
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
          label:
            type === "rowMenu"
              ? "Download CoC Report as PDF"
              : "Download as PDF",
          onClick: () => {
            handleDownloadReport(
              getPdfReportApi,
              row.jobRunId,
              ReportENUM.COC,
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
