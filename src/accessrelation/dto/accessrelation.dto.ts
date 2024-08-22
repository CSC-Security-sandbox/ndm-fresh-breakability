import { IsMongoId, IsOptional, Validate, ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import mongoose from "mongoose";

@ValidatorConstraint({ name: 'atLeastTwoIds', async: false })
class AtLeastTwoIdsConstraint implements ValidatorConstraintInterface {
    validate(value: any, args: ValidationArguments) {
        const object = args.object as AccessRelationDTO;
        const ids = [object.user, object.customer, object.role, object.project];
        const nonEmptyIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id));
        return nonEmptyIds.length >= 2;
    }

    defaultMessage(args: ValidationArguments) {
        return 'At least two of userId, customerId, roleId, or projectId must be valid MongoDB ObjectIds';
    }
}

export class AccessRelationDTO {
    @ApiProperty({
        description: "userId",
    })
    @IsOptional()
    @IsMongoId()
    user: string;

    @ApiProperty({
        description: "customerId",
    })
    @IsOptional()
    @IsMongoId()
    customer: string;

    @ApiProperty({
        description: "roleId",
    })
    @IsOptional()
    @IsMongoId()
    role: string;

    @ApiProperty({
        description: "projectId",
    })
    @IsOptional()
    @IsMongoId()
    project: string;

    @Validate(AtLeastTwoIdsConstraint)
    validateAtLeastTwoIds: boolean;
}
