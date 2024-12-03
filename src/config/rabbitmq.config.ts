import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RabbitMQConfigService {
  constructor(private configService: ConfigService) { }

  get user(): string {
    return this.configService.get<string>('RABBITMQ_USER');
  }

  get password(): string {
    return this.configService.get<string>('RABBITMQ_PASSWORD');
  }

  get hosts(): string[] {
    const hosts = this.configService.get<string>('RABBITMQ_HOSTS');

    if (hosts === undefined) {
      return [];
    }
    return hosts.split(',');
  }

  get ports(): number[] {
    const ports = this.configService.get<string>('RABBITMQ_PORTS');

    if (ports === undefined) {
      return [];
    }
    return ports.split(',').map(Number);
  }

  get uris(): string[] {
    const user = this.user;
    const password = this.password;
    const ports = this.ports;
    const hosts = this.hosts;

    if (user === undefined || password === undefined) {
      return hosts.map((host, index) => `amqp://${host}:${ports[index]}`);
    } else {
      return hosts.map(
        (host, index) => `amqp://${user}:${password}@${host}:${ports[index]}`,
      );
    }
  }

  get taskQueueName(): string {
    return this.configService.get<string>('RABBITMQ_TASK_LIST_QUEUE');
  }

  get inventoryQueueName(): string {
    return this.configService.get<string>('RABBITMQ_INVENTORY_QUEUE');
  }

}
