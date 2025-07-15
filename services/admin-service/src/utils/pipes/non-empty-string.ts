import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

@Injectable()
export class NonEmptyStringPipe implements PipeTransform {
  transform(value: string) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException('ID must be a non-empty string');
    }
    return value;
  }
}