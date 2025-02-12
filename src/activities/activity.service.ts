import { Injectable } from '@nestjs/common';
import { ActivityInterface } from '@temporalio/workflow';

@Injectable()
export class MyActivity {
  constructor() {}

  async doSomething(input: string): Promise<string> {

    console.log('asabakbasmdbasmb')
    return 'askdnas'
  }
}
