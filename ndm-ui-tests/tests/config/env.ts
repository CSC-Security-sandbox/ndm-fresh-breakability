import * as dotenv from "dotenv";

// Load environment variables from .env file once
dotenv.config();

// Export all environment variables as constants
export const BASE_URL = process.env.BASE_URL || "http://localhost:3111";

export const ADMIN_CREDENTIALS = {
  username: process.env.ADMIN_USERNAME || "admin@datamigrator.local",
  password: process.env.ADMIN_PASSWORD || "Root@123",
};

// Other environment configurations can be added here
export const SHOULD_BROWSER_STAY_OPEN =
  process.env.SHOULD_BROWSER_STAY_OPEN_AFTER_TEST === "true";
