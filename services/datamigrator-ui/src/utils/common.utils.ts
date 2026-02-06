import {
  FILE_SERVER_STATUS_ENUM,
  JOB_CONFIG_STATUS_ENUM,
  JOBS_TYPE,
} from "@/types/app.type";
import { USER_ROLES_ENUM } from "@/types/app.type";

const hexToBytes = (hex: string): Uint8Array =>
  new Uint8Array(hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const getKeyFromSecret = async (keyString: string): Promise<Uint8Array> => {
  const encoded = new TextEncoder().encode(keyString);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return new Uint8Array(hashBuffer);
};

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

export const decryptData = async (encryptedWithIv: string): Promise<string> => {
  try {
    const [ivHex, encryptedPassword] = encryptedWithIv.split(":");
    const iv = hexToBytes(ivHex);
    const keyString =
      window?.env?.VITE_KEYCLOAK_CLIENT_SECRET ||
      import.meta.env.VITE_KEYCLOAK_CLIENT_SECRET;
    const keyBytes = await getKeyFromSecret(keyString);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-CTR" },
      false,
      ["decrypt"]
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-CTR", counter: iv, length: 64 },
      cryptoKey,
      hexToBytes(encryptedPassword)
    );
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    throw new Error("An internal error occurred");
  }
};

export const encryptData = async (data: string): Promise<string> => {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const keyString =
      window?.env?.VITE_KEYCLOAK_CLIENT_SECRET ||
      import.meta.env.VITE_KEYCLOAK_CLIENT_SECRET;
    const keyBytes = await getKeyFromSecret(keyString);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-CTR" },
      false,
      ["encrypt"]
    );
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-CTR", counter: iv, length: 64 },
      cryptoKey,
      new TextEncoder().encode(data)
    );
    return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(encrypted))}`;
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
