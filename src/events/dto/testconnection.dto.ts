import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

class ActionDTO {
    @ApiProperty({ description: 'Event Type', example: 'TestEvent' })
    @IsString()
    @IsNotEmpty()
    eventType: string;

    @ApiProperty({ description: 'Message', example: 'Test message' })
    @IsString()
    @IsNotEmpty()
    message: string;
}

export class TestConnectionDTO {
    @ApiProperty({ description: 'AgentId Id', example: '60c72b2f9b1e8b001c8b4567' })
    @IsString()
    @IsNotEmpty()
    agentId: string;

    @ApiProperty({ description: 'Action object containing event type and message' })
    @ValidateNested()
    @Type(() => ActionDTO)
    @IsNotEmpty()
    action: ActionDTO;
}
