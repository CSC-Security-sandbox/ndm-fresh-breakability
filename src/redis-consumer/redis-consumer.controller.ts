import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { RedisConsumerService } from "./redis-consumer.service";
import { ConsumerDto } from "./consumer-dto";
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiBody } from "@nestjs/swagger";

@Controller("redis-consumer")
export class RedisConsumerController {
  constructor(private readonly redisConsumerService: RedisConsumerService) {}

  
  @Post("start")
  @ApiBody({ description: 'Consumer Details', type: ConsumerDto })
  async start(
   @Body() consumerDto: ConsumerDto,
  ) {
    const {jobRunId, readerName, consumerType } = consumerDto;  
   const result =  await this.redisConsumerService.startConsumer(jobRunId, readerName, consumerType);
   return result;
  }

  @Post("stop/:jobRunId/:consumerType")
  async stop(@Param("jobRunId") jobRunId: string, @Param("consumerType") consumerType: string) {
   const response= await this.redisConsumerService.stopConsumer(jobRunId, consumerType);
    return response;
  }

  @Post("delete/:jobRunId/:consumerType")
  async delete(@Param("jobRunId") jobRunId: string, @Param("consumerType") consumerType: string) {
   const response= await this.redisConsumerService.stopConsumer(jobRunId, consumerType);
    return response;
  }

  @Get('list')
  async listWorkers() {
    return this.redisConsumerService.listConsumers();
  }
}
