import { notify } from "@components/notification/NotificationWrapper";

export const handleDownloadReport = async (
  downloadReports: (arg: any) => any,
  jobRunId: string,
  reportType: string = "discovery",
  fileType: string
) => {
  const isFileTypePdf = fileType.toLowerCase() === "pdf";
  try {
    const response = await downloadReports({
      jobRunId: isFileTypePdf ? jobRunId : [jobRunId],
      "report-type": reportType,
    }).unwrap();

    const mimeType = getMimeType(fileType);
    const extension = fileType.toLowerCase();

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

export const createUrl = (body: Record<string, string | number>) => {
  let url = "";
  const { jobRunId, jobConfigId } = body;
  if (jobRunId) {
    url += `jobRunId=${jobRunId}`;
  } else {
    url += `jobConfigId=${jobConfigId}`;
  }
  return url;
};

export const handleDownloadErrorsLogs = async (
  downloadReports: (arg: any) => any,
  body: Record<string, string | number>,
  fileType: string = "CSV"
) => {
  try {
    const queryParams = createUrl(body);
    const response = await downloadReports(queryParams).unwrap();
    const Id = body.jobRunId || body.jobConfigId;
    const mimeType = getMimeType(fileType);
    const extension = fileType.toLowerCase();
    const timestamp = getTimestamp();

    createAndDownloadBlob(
      response,
      mimeType,
      `error-log-${Id}-${timestamp}.${extension}`
    );
  } catch (error) {
    console.error("Failed to download Error Report:", error?.data?.message);
    notify.error(
      error?.data?.displayMessage || "Failed to download Error Report."
    );
  }
};

const createAndDownloadBlob = (
  data: BlobPart,
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
