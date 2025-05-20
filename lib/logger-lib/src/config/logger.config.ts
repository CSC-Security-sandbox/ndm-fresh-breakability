import { registerAs } from "@nestjs/config";
import { LoggerOptions } from "./logger.type";


export default registerAs('loggerOptions', (): LoggerOptions => ({
    service : process.env.SERVICE || '',
}));