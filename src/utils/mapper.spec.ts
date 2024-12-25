
import { Operations } from 'src/constants/status';
import { OperationType, Protocol, TaskType } from 'src/constants/enums';
import { operationsTypeToTaskType, OperationToProtocol } from './mapper';

describe('OperationToProtocol', () => {


  it('should return NFS for LIST_NFS_PATHS', () => {
    const result = OperationToProtocol(Operations.LIST_NFS_PATHS);
    expect(result).toBe(Protocol.NFS);
  });

  it('should return NFS for VALIDATE_NFS_CONNECTION', () => {
    const result = OperationToProtocol(Operations.VALIDATE_NFS_CONNECTION);
    expect(result).toBe(Protocol.NFS);
  });


  it('should return SMB for LIST_SMB_PATHS', () => {
    const result = OperationToProtocol(Operations.LIST_SMB_PATHS);
    expect(result).toBe(Protocol.SMB);
  });

  it('should return SMB for VALIDATE_SMB_CONNECTION', () => {
    const result = OperationToProtocol(Operations.VALIDATE_SMB_CONNECTION);
    expect(result).toBe(Protocol.SMB);
  });


  it('should throw an error for an invalid operation', () => {

    const invalidOperation = 'INVALID_OPERATION' as Operations;

    expect(() => OperationToProtocol(invalidOperation)).toThrowError('Invalid Operation');
  });


  it('should throw an error if no operation is provided', () => {
    // @ts-ignore: Test missing operation (undefined)
    expect(() => OperationToProtocol(undefined)).toThrowError('Invalid Operation');
    
    // @ts-ignore: Test null operation
    expect(() => OperationToProtocol(null)).toThrowError('Invalid Operation');
  });

});


describe('operationsTypeToTaskType', () => {
  it('should return TaskType.Scan when OperationType.SCAN is provided', () => {
    const result = operationsTypeToTaskType(OperationType.SCAN);
    expect(result).toBe(TaskType.Scan);
  });

  it('should throw an error for an invalid operation type', () => {
    const invalidOperation = 'INVALID_OPERATION' as OperationType;
    expect(() => operationsTypeToTaskType(invalidOperation)).toThrowError('Invalid Operation');
  });
});