import { Module} from "@nestjs/common";
import { RequestContext } from "./request-context";
import {AsyncLocalStorageModule} from "../async-local-storage/async-local-storage.module";

@Module({
  imports: [AsyncLocalStorageModule],
  providers: [RequestContext],
  exports: [RequestContext],
})
export class RequestContextModule {}