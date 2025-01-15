import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";


export class AdHocRunDTO{
    @ApiProperty({ description: "UUID of Job Config Id" })
    @IsUUID()
    jobConfigId: string;
}