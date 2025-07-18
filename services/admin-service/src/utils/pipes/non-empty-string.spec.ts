import { NonEmptyStringPipe } from './non-empty-string';
import { BadRequestException } from '@nestjs/common';

describe('NonEmptyStringPipe', () => {
  let pipe: NonEmptyStringPipe;

  beforeEach(() => {
    pipe = new NonEmptyStringPipe();
  });

  it('should return the value if it is a non-empty string', () => {
    expect(pipe.transform('abc')).toBe('abc');
    expect(pipe.transform('  abc  ')).toBe('  abc  ');
  });

  it('should throw BadRequestException for empty string', () => {
    expect(() => pipe.transform('')).toThrow(BadRequestException);
  });

  it('should throw BadRequestException for whitespace string', () => {
    expect(() => pipe.transform('   ')).toThrow(BadRequestException);
  });

  it('should throw BadRequestException for non-string values', () => {
    expect(() => pipe.transform(null as any)).toThrow(BadRequestException);
    expect(() => pipe.transform(undefined as any)).toThrow(BadRequestException);
    expect(() => pipe.transform(123 as any)).toThrow(BadRequestException);
    expect(() => pipe.transform({} as any)).toThrow(BadRequestException);
  });
});
