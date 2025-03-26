import { notify } from "@components/notification/NotificationWrapper";

export const handleDownloadReport = async (
  downloadReports: (arg: any) => any,
  jobRunId: string,
  reportType: string = "discovery",
  fileType: string
) => {
  const isFileTypePdf = fileType === "pdf";
  try {
    const response = await downloadReports({
      jobRunId: isFileTypePdf ? jobRunId : [jobRunId],
      "report-type": reportType,
    }).unwrap();

    const appType = isFileTypePdf
      ? "application/octetstream"
      : "application/zip";

    const blob = new Blob([response], { type: appType });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${jobRunId}-${reportType}-report.${
      isFileTypePdf ? "pdf" : "zip"
    }`;
    link.click();

    URL.revokeObjectURL(link.href);
  } catch (error) {
    console.error("Failed to download the report:", error);
    notify.error("Report not generated yet, please try again after some time");
  }
};
