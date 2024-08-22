import { Injectable, ConflictException, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateCustomerDTO } from './dto/createcustomer.dto';
import { Customer } from 'src/schemas/Customer.schema';
import { CustomerPagenDTO } from './dto/customerpage.dto';
import { UpdateCustomerDTO } from './dto/updatecustomer.dto';


@Injectable()
export class CustomerService {
    constructor(
        @InjectModel(Customer.name)
        private readonly customerModel: Model<Customer>,
    ) {}

    createCustomer(createCustomerDTO: CreateCustomerDTO) {
        const newCustomer = new this.customerModel(createCustomerDTO);
        try {
            return  newCustomer.save();
        } catch (error) {
            if (error.code === 11000) 
                throw new ConflictException('Customer already exists');
            else 
                throw new InternalServerErrorException('Could not create customer');
        }
    }

    async updateCustomerById(id: string, updateCustomerDTO: UpdateCustomerDTO) {
        return this.customerModel.findByIdAndUpdate(id, updateCustomerDTO, { new: true }).exec();
    }

    async findAllCustomers(customerPagenDTO: CustomerPagenDTO) {
        const { page = 1, limit = 10 } = customerPagenDTO;
        const skip = (page - 1) * limit;
        return this.customerModel.find().skip(skip).limit(limit).exec();
    }

    async findCustomersById(id: string) {
        return this.customerModel.findById(id).exec();
    }

    async deleteCustomerById(id: string) {
        return this.customerModel.findByIdAndDelete(id).exec();
    }
}