import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsUUID, ValidateNested } from "class-validator";

export class UserRoleMap{
    @ApiProperty({ description: 'User Id for which project is to be created' })
    @IsUUID()
    user_id: string;
  
    @ApiProperty({ description: 'Role Id for which project is to be created' })
    @IsUUID()
    role_id: string;
  
}

export class UserRoleRelationDto{
    @ApiProperty({ description: 'Project Id for which project is to be created' })
    @IsUUID()
    project_id: string;
  
    @ApiProperty({ description: 'Account Id for which project is to be created' })
    @IsUUID()
    account_id: string;

    @ApiProperty({ description: 'Array of User Map details', type: [UserRoleMap] })
    @IsArray()
    @ValidateNested({ each: true }) 
    @Type(() => UserRoleMap) 
    users: UserRoleMap[]
}