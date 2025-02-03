import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { RedisConsumerService } from "./redis-consumer.service";
import { ConsumerDto } from "./consumer-dto";
import { Cron, CronExpression } from '@nestjs/schedule';

@Controller("redis-consumer")
export class RedisConsumerController {
  constructor(private readonly redisConsumerService: RedisConsumerService) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleCron(){
     this.redisConsumerService.startConsumers()
  }

  
  @Post("start")
  async start(
   @Body() consumerDto: ConsumerDto,
  ) {
    const { streamKey, jobRunId, readerName, consumerType } = consumerDto;  
    await this.redisConsumerService.startConsumer(
      streamKey,
      jobRunId,
      readerName,
      consumerType
    );
    return { message: `Consumer started for ${streamKey}` };
  }

  @Post("stop/:streamKey")
  async stop(@Param("streamKey") streamKey: string) {
    await this.redisConsumerService.stopConsumer(streamKey);
    return { message: `Consumer stopped for ${streamKey}` };
  }

  @Get("list")
  async list() {
    const consumers = await this.redisConsumerService.listRunningConsumers();
    return { runningConsumers: consumers };
  }

  @Get("status/:streamKey")
  async status(@Param("streamKey") streamKey: string) {
    const status = await this.redisConsumerService.getConsumerStatus(streamKey);
    return { streamKey, status };
  }
}
