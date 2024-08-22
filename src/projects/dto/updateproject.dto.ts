import { IsDate, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { BadRequestException } from "@nestjs/common";

export class UpdatedProjectDTO {
    @ApiPropertyOptional({
        description: "Name of Project",
        example: "Project"
    })
    @IsOptional()
    @IsString()
    name: string;

    @ApiPropertyOptional({
        description: "StartDate",
        example: new Date().toISOString()
    })
    @IsOptional()
    @Transform(({ value }) => {
        const date = new Date(value);
        if (isNaN(date.getTime())) {
            throw new BadRequestException(`Invalid date: ${value}`);
        }
        return date;
    })
    startDate: Date;

    @ApiProperty({
        description: "UpdatedBy",
        example: "_id"
    })
    @IsNotEmpty()
    @IsString()    
    UpdatedBy: string;
}
