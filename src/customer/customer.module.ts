import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Customer, CustomerSchema } from 'src/schemas/Customer.schema';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';

@Module({
    imports: [
        MongooseModule.forFeature([{
            name: Customer.name,
            schema: CustomerSchema
        }])
    ],
    providers:[CustomerService],
    controllers: [CustomerController]
})
export class CustomerModule {}
