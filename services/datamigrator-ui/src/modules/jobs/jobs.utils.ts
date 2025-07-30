import { notify } from "@components/notification/NotificationWrapper";
import { REPORT_TYPES_ENUM } from "@/types/app.type";

export const handleDownloadReport = async (
  downloadReports: (arg: any) => any,
  jobRunId: string,
  reportType: string = REPORT_TYPES_ENUM.DISCOVERY,
  fileType: string
) => {
  const isFileTypePdf = fileType.toLowerCase() === "pdf";
  try {
    const response = await downloadReports({
      jobRunId: isFileTypePdf ? jobRunId : [jobRunId],
      "report-type": reportType,
    }).unwrap();

    const mimeType = isFileTypePdf ? getMimeType(fileType) : getMimeType("ZIP");
    const extension = isFileTypePdf ? fileType.toLowerCase() : "zip";

    createAndDownloadBlob(
      response,
      mimeType,
      `${jobRunId}-${reportType}-report.${extension}`
    );
  } catch (error) {
    console.error("Failed to download the report:", error);
    notify.error("Report not generated yet, please try again after some time.");
  }
};

export const handleDownloadErrorsLogs = async (
  downloadReports: (arg: any) => any,
  body: Record<string, string | number>,
  fileType: string = "CSV"
) => {
  try {
    const response = await downloadReports(body).unwrap();
    const { id } = body;
    const mimeType = getMimeType(fileType);
    const extension = fileType.toLowerCase();
    const timestamp = getTimestamp();

    createAndDownloadBlob(
      response,
      mimeType,
      `error-log-${id}-${timestamp}.${extension}`
    );
  } catch (error) {
    console.error("Failed to download Error Report:", error?.data?.message);
    notify.error(
      error?.data?.displayMessage || "Failed to download Error Report."
    );
  }
};

export const handleDownloadCocReport = async (
  downloadReports: (arg: any) => any,
  jobRunId: string,
  reportType: string = REPORT_TYPES_ENUM.COC
) => {
  try {
    const response = await downloadReports({
      jobRunId: [jobRunId],
      "report-type": reportType,
    }).unwrap();
    const mimeType = getMimeType("ZIP");
    const extension = "zip";

    createAndDownloadBlob(
      response,
      mimeType,
      `coc-report-${jobRunId}.${extension}`
    );
  } catch (error) {
    console.error("Failed to download CoC report:", error);
    notify.error(
      "CoC report not generated yet, please try again after some time."
    );
  }
};

export const createAndDownloadBlob = (
  data: BlobPart | any,
  type: string,
  fileName: string
) => {
  const blob = new Blob([data], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
};

const getTimestamp = () =>
  new Date().toISOString().slice(0, 19).replace(/[-T:]/g, "");

export enum FileMimeType {
  CSV = "text/csv",
  PDF = "application/octetstream",
  ZIP = "application/zip",
}

export const getMimeType = (fileType: string): string => {
  switch (fileType.toLowerCase()) {
    case "csv":
      return FileMimeType.CSV;
    case "pdf":
      return FileMimeType.PDF;
    case "zip":
    default:
      return FileMimeType.ZIP;
  }
};
