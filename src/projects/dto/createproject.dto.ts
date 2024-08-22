import { IsDate, IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";

export class CreateProjectDTO{
    @ApiProperty({
        description: "Name of Project",
        example: "Project"
    })
    @IsNotEmpty()
    @IsString()
    name: string;

    @ApiProperty({
        description: "UserId of creator",
        example: new Date()
    })
    @IsNotEmpty()
    @Transform(({ value }) => new Date(value))
    @IsDate()    
    startDate: Date;

    @ApiProperty({
        description: "UserId of creator",
        example: "UUID"
    })
    @IsNotEmpty()
    @IsString()    
    createdBy: string;
}