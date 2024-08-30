import * as dotenv from 'dotenv';
dotenv.config();

export const AppConfig = {
  DB_URI: process.env.DB_URI,
  SERVER_PORT: process.env.SERVER_PORT,
};