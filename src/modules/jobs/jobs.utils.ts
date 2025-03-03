import { notify } from "@components/notification/NotificationWrapper";

export const handleDownloadReport = async (
  downloadReports: Function,
  jobRunId: string,
  reportType: string = "discovery",
  fileType: string
) => {
  try {
    const response = await downloadReports({
      jobRunId: fileType == "pdf" ? jobRunId : [jobRunId],
      "report-type": reportType,
    }).unwrap();

    const blob = new Blob([response], { type: "application/zip" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${jobRunId}-${reportType}-report.zip`;
    link.click();

    URL.revokeObjectURL(link.href);
  } catch (error) {
    console.error("Failed to download the report:", error);
    notify.error("Report not generated yet, please try again after some time");
  }
};
