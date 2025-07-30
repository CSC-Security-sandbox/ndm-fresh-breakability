export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}



export class FatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalError';
  }
}


export class RetryExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryExceededError';
  }
}