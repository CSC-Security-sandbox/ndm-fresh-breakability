import { Test, TestingModule } from '@nestjs/testing';
import { SchedularService } from './schedule.service';
import { JobConfigService } from '../jobconfig/jobconfig.service';
import { JobRunService } from '../jobrun/jobrun.service';
import { Between } from 'typeorm';
import { EventsGateway } from '../events/getway/events.gateway';

describe('SchedularService', () => {
  it('should be defined', () => {
    expect('schedularService').toEqual('schedularService');
  });
});