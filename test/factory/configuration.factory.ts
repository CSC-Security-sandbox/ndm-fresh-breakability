import { Types } from "mongoose";
import { CreateConfigurationDto } from "../../src/configurations/dto/createconfiguration.dto";
import { ConfigurationType, Protocol } from "../../src/schemas/Configuration.schema";

export const mockConfigurationData: CreateConfigurationDto = {
    projectId: new Types.ObjectId("66c85422795052061b4237f8"),
    configurationType: ConfigurationType.file,
    userName: "admin",
    host: "127.0.0.1",
    protocal: Protocol.NFS,
};