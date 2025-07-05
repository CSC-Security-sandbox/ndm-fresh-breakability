import { registerAs } from "@nestjs/config";
import {ResponseHandlerOptions} from './response-handler.type';


export default registerAs('responseHandlerOptions', (): ResponseHandlerOptions => ({
    service : process.env.SERVICE || '',
}));