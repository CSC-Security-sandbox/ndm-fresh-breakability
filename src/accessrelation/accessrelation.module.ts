import { Module } from '@nestjs/common';
import { AccessrelationController } from './accessrelation.controller';
import { AccessrelationService } from './accessrelation.service';
import { MongooseModule } from '@nestjs/mongoose';
import { AccessRelation, AccessRelationSchema } from 'src/schemas/accessrelation.schema';
import { User, UserSchema } from 'src/schemas/User.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AccessRelation.name, schema: AccessRelationSchema},
    ])
  ],
  controllers: [AccessrelationController],
  providers: [AccessrelationService]
})
export class AccessrelationModule {}
