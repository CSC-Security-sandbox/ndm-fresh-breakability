import { RegisterWorkerDto, RegisterWorkerResponseDto } from './register-worker.dto';

describe('RegisterWorkerDto', () => {
  it('should be defined', () => {
    const dto = new RegisterWorkerDto();
    expect(dto).toBeDefined();
  });
});

describe('RegisterWorkerResponseDto', () => {
  let responseDto: RegisterWorkerResponseDto;

  beforeEach(() => {
    responseDto = new RegisterWorkerResponseDto();
  });

  it('should be defined', () => {
    expect(responseDto).toBeDefined();
  });

  it('should initialize with constructor values', () => {
    const workerId = 'test-worker-id';
    const workerSecret = 'test-worker-secret';
    const controlPlaneIp = '192.168.1.1';

    const dto = new RegisterWorkerResponseDto(workerId, workerSecret, controlPlaneIp);

    expect(dto.workerId).toBe(workerId);
    expect(dto.workerSecret).toBe(workerSecret);
    expect(dto.controlPlaneIp).toBe(controlPlaneIp);
  });

  it('should set workerId using setter', () => {
    const workerId = 'new-worker-id';
    responseDto.setWorkerId = workerId;
    expect(responseDto.workerId).toBe(workerId);
  });

  it('should set workerSecret using setter', () => {
    const workerSecret = 'new-worker-secret';
    responseDto.setWorkerSecret = workerSecret;
    expect(responseDto.workerSecret).toBe(workerSecret);
  });

  it('should set controlPlaneIp using setter', () => {
    const controlPlaneIp = '10.0.0.1';
    responseDto.setControlPlaneIp = controlPlaneIp;
    expect(responseDto.controlPlaneIp).toBe(controlPlaneIp);
  });
});