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

export class RoleMap{
    @ApiProperty({ description: 'Role Id for which project is to be created' })
    @IsUUID()
    roleId: string;
  
    @ApiProperty({ description: 'Role Name for which project is to be created' })
    roleName: string;

    @ApiProperty({ description: 'Project Id for which project is to be created' })
    projectId: string;

}
export class UserRoleMappingDto{
    @ApiProperty({ description: 'User Id for which project is to be created' })
    @IsUUID()
    userId: string;

    @ApiProperty({ description: 'Name of the user' })
    userName: string;

    @ApiProperty({ description: 'Email of the user' })
    email: string;

    @ApiProperty({ description: 'User Status Active/Inactive' })
    userStatus: string;

    @ApiProperty({ description: 'Array of User roles details', type: [RoleMap] })
    @IsArray()
    @ValidateNested({ each: true }) 
    @Type(() => RoleMap) 
    roles: RoleMap[]
}

export class UserRoleMappingResponseDto{

    @ApiProperty({ description: 'Total number of records' })
    total: number;

    @ApiProperty({ description: 'Current page number' })
    page: number;

    @ApiProperty({ description: 'Number of records per page' })
    limit: number;

    @ApiProperty({ description: 'Array of User Role Mapping details', type: [UserRoleMappingDto] })
    data: UserRoleMappingDto[];
}

