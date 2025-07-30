import {
  FILE_SERVER_STATUS_ENUM,
  JOB_CONFIG_STATUS_ENUM,
  JOBS_TYPE,
} from "@/types/app.type";
import crypto from "crypto";
import { USER_ROLES_ENUM } from "@/types/app.type";

export const getJobType = (type: JOBS_TYPE) => {
  switch (type) {
    case JOBS_TYPE["DISCOVERY"]:
      return "Discovery";
    case JOBS_TYPE["CUT_OVER"]:
      return "Cutover";
    case JOBS_TYPE["MIGRATE"]:
      return "Migration";
    default:
      return type;
  }
};

export const getJobTypeTextForHeader = (type: JOBS_TYPE) => {
  switch (type) {
    case JOBS_TYPE["DISCOVERY"]:
      return "Discovered";
    case JOBS_TYPE["MIGRATE"]:
    case JOBS_TYPE["CUT_OVER"]:
      return "Migrated";
    default:
      return type;
  }
};

export const getJobStatusFormat = (status: JOB_CONFIG_STATUS_ENUM) => {
  switch (status) {
    case JOB_CONFIG_STATUS_ENUM.ACTIVE:
      return "Active";
    case JOB_CONFIG_STATUS_ENUM.INACTIVE:
      return "Inactive";
    default:
      return status;
  }
};

export const formatLength = (length: number | undefined) => {
  if (length === undefined || length === 0) return "0";
  return length < 10 ? `0${length}` : `${length}`;
};

// THIS WILL CONVERT  STRING INTO TITLE CASE (eg. Title Case)
export const toTitleCase = (str: string = "") => {
  return str?.replace(
    /\w\S*/g,
    (text) => text?.charAt(0)?.toUpperCase() + text?.substring(1)?.toLowerCase()
  );
};

/**
 * Find time difference in milliseconds between two date strings.
 * @param {string} startDateTimeStr The start date.
 * @param {string} endDateTimeStr The end date, if not sent it will pick current date.
 * @return {number} Difference in milliseconds.
 */
export const calculateTimeDiff = (
  startDateTimeStr: string,
  endDateTimeStr?: string
) => {
  if (!startDateTimeStr) return 0;
  const now: Date = new Date();
  const startDateTime: Date = new Date(startDateTimeStr);
  const endDateTime: Date = endDateTimeStr ? new Date(endDateTimeStr) : now;

  const diffInMs = +endDateTime - +startDateTime;
  return diffInMs;
};

/**
 * Generate options for range, by passing size.
 * @param {number} size Range size for generating options.
 * @return Return label value object.
 */
export const generateOptionsWithRange = (size: number = 31) =>
  Array.from(Array(size).keys()).map((num) => ({
    label: (num + 1).toString(),
    value: num + 1,
  }));

export const getOptionsFromArray = (data?: string[] | number[]) => {
  if (!data) return [];
  return data.map((value) => ({
    label: value,
    value,
  }));
};

export const convertFileToBase64 = (file: any) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result); // Base64 string
    reader.onerror = (error) => reject(error);
  });
};

export const getGrafanaLogUrl = (searchParam: string) => {
  const query = JSON.stringify({
    datasource: "Loki",
    queries: [
      {
        expr: `{namespace="datamigrator"} |~ "${searchParam}"`,
        refId: "A",
        queryType: "logs",
        legendFormat: "",
        intervalMs: 1000,
        maxLines: 1000,
      },
    ],
    range: { from: "now-1h", to: "now" },
  });

  const encodedQuery = encodeURIComponent(query);

  return `${
    window?.env?.VITE_GRAFANA_URL || import.meta.env.VITE_GRAFANA_URL
  }/explore?left=${encodedQuery}`;
};

export const getFileServerStatusFormat = (status: FILE_SERVER_STATUS_ENUM) => {
  switch (status) {
    case FILE_SERVER_STATUS_ENUM.IN_PROGRESS:
      return "In Progress";
    default:
      return toTitleCase(status);
  }
};

export const decryptData = (encryptedWithIv: string): string => {
  try {
    const [ivHex, encryptedPassword] = encryptedWithIv.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const keyString =
      window?.env?.VITE_KEYCLOAK_CLIENT_SECRET ||
      import.meta.env.VITE_KEYCLOAK_CLIENT_SECRET;
    const key = crypto.createHash("sha256").update(keyString).digest();
    const decipher = crypto.createDecipheriv("aes-256-ctr", key, iv);
    let decrypted = decipher.update(encryptedPassword, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    throw new Error("An internal error occurred");
  }
};

export const encryptData = (data: string): string => {
  try {
    const iv = crypto.randomBytes(16);
    const keyString =
      window?.env?.VITE_KEYCLOAK_CLIENT_SECRET ||
      import.meta.env.VITE_KEYCLOAK_CLIENT_SECRET;
    const key = crypto.createHash("sha256").update(keyString).digest();
    const cipher = crypto.createCipheriv("aes-256-ctr", key, iv);
    let encrypted = cipher.update(data, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `${iv.toString("hex")}:${encrypted}`;
  } catch (error) {
    throw new Error("An internal error occurred");
  }
};

export const getProjectPermissions = (projectId: string, userPermissions) => {
  return userPermissions.roles.find(
    (row) =>
      row.projects.includes(projectId) ||
      (row.role_name === USER_ROLES_ENUM.APP_ADMIN && row.projects.length === 0)
  )?.permissions;
};
