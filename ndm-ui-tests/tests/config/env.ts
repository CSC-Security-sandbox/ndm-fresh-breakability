import * as dotenv from "dotenv";

// Load environment variables from .env file once
dotenv.config();

// Export all environment variables as constants
export const BASE_URL = process.env.BASE_URL || "http://localhost:3111";

// User credentials
export const APP_ADMIN_CREDENTIALS = {
  username: process.env.APP_ADMIN_USERNAME || "admin@datamigrator.local",
  password: process.env.APP_ADMIN_PASSWORD || "Root@123",
};

export const PROJECT_ADMIN_CREDENTIALS = {
  username:
    process.env.PROJECT_ADMIN_USERNAME || "projectadmin@datamigrator.local",
  password: process.env.PROJECT_ADMIN_PASSWORD || "Root@123",
};

export const PROJECT_VIEWER_CREDENTIALS = {
  username: process.env.PROJECT_VIEWER_USERNAME || "viewer@datamigrator.local",
  password: process.env.PROJECT_VIEWER_PASSWORD || "Root@123",
};

// Navigation URLs
export const FILE_SERVER_URL = `${BASE_URL}/${process.env.FILE_SERVER || "file-server"}`;
