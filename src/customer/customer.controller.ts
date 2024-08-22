import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from "@nestjs/common";
import mongoose from "mongoose";
import { ApiAcceptedResponse, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CustomerService } from "./customer.service";
import { CreateCustomerDTO } from "./dto/createcustomer.dto";
import { Customer } from "src/schemas/Customer.schema";
import { CustomerPagenDTO } from "./dto/customerpage.dto";
import { UpdateCustomerDTO } from "./dto/updatecustomer.dto";

@ApiTags("Customer")
@Controller('customer')
export class CustomerController{
    constructor(private customerService: CustomerService){}

    @ApiOperation({summary: 'Create Customer'})
    @ApiCreatedResponse({description: 'Customer Created Succesfully.', type: Customer})
    @Post()
    createCustomer(@Body() createCustomerDTO: CreateCustomerDTO) {
        return this.customerService.createCustomer(createCustomerDTO)   
    }

    @ApiOperation({summary: 'Get Page of Customer List'})
    @ApiOkResponse({description: 'ok', type:[Customer]})
    @Post('/all')
    async getUsers(@Body() CustomerPagenDTO: CustomerPagenDTO) {
        return await this.customerService.findAllCustomers(CustomerPagenDTO)
    }

    @ApiOperation({summary: 'Get Customer by customer id'})
    @ApiOkResponse({description: 'ok', type:Customer})
    @Get(':id')
    async getCustomerById(@Param('id') id: string) {
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if(!isValid) throw new BadRequestException('CustomerId Is Invalid.')
        const customer = await this.customerService.findCustomersById(id);
        if(!customer) throw new NotFoundException('Customer Not Found.')
        return customer
    }

    @ApiOperation({summary: 'Update Customer'})
    @ApiOkResponse({description: 'ok', type:Customer})
    @Patch(':id')
    async updateCustomer(@Param('id') id: string, @Body() updateCustomerDTO: UpdateCustomerDTO){
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if(!isValid) throw new BadRequestException('Customer ID Is Invalid.')
        const customer = await this.customerService.updateCustomerById(id, updateCustomerDTO);
        if(!customer) throw new NotFoundException('Customer Not Found.')
        return customer
    }

    @ApiOperation({summary: 'Delete Customer'})
    @ApiAcceptedResponse({description: 'ok', type:Customer})
    @Delete(":id")
    async deleteCustomer(@Param('id') id: string) {
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if(!isValid) throw new BadRequestException('Customer Id Is Invalid.')
        const customer = await this.customerService.deleteCustomerById(id);
        if(!customer) throw new NotFoundException('Customer Not Found.')
        return customer
    }

}