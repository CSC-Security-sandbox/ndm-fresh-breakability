import { ErrorCollection, FileCollection } from './stream-collection';

describe('StreamCollection Interfaces', () => {
  it('should create a FileCollection instance', () => {
    const fileCollection: FileCollection = {
      jobRunId: 'job1',
      streamKey: 'stream1',
      numMessages: 0,
      lastId: '0-0',
      init: jest.fn(),
      cleanup: jest.fn(),
      close: jest.fn(),
      append: jest.fn(),
      appendBulk: jest.fn(),
      read: jest.fn(),
      groupRead: jest.fn(),
      consumerGroupCount:2,
      readAndPurge: jest.fn(),
      getLength: jest.fn(),
      groupReadWithoutAck: jest.fn(),
      drainPendingEntries: jest.fn(),
      ackAndPurge: jest.fn(),
    };
    expect(fileCollection).toBeDefined();
  });

  it('should create an ErrorCollection instance', () => {
    const errorCollection: ErrorCollection = {
      jobRunId: 'job1',
      streamKey: 'stream1',
      numMessages: 0,
      lastId: '0-0',
      init: jest.fn(),
      cleanup: jest.fn(),
      close: jest.fn(),
      append: jest.fn(),
      appendBulk: jest.fn(),
      read: jest.fn(),
      groupRead: jest.fn(),
      consumerGroupCount:2,
      readAndPurge: jest.fn(),
      groupReadWithoutAck: jest.fn(),
      drainPendingEntries: jest.fn(),
      ackAndPurge: jest.fn(),
      getLength: jest.fn(),
    };
    expect(errorCollection).toBeDefined();

  });
  });

  // ...similar tests for DirectoryCollection, TaskStatsCollection, TaskCollection...
