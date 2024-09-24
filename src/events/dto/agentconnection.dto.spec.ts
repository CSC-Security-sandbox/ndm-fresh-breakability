import { validate } from 'class-validator';
import { AgentDetails, NFSConnectionDetails, SMBConnectionDetails, TestConnectionsDTO } from './agentconnection.dto';

describe('TestConnectionsDTO', () => {
  it('should pass validation when valid data is provided', async () => {
    const dto = new TestConnectionsDTO();
    dto.agents = [new AgentDetails()];
    dto.agents[0].agentId = 'agentId';
    dto.nfsConnectionDetails = new NFSConnectionDetails();
    dto.nfsConnectionDetails.userName = 'username';
    dto.nfsConnectionDetails.password = 'password';
    dto.nfsConnectionDetails.host = 'host';
    dto.nfsConnectionDetails.protocol = 'protocol';

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail validation when both connection details are missing', async () => {
    const dto = new TestConnectionsDTO();
    dto.agents = [new AgentDetails()];
    dto.agents[0].agentId = 'agentId';
    dto.validateConnection = true; 

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('atLeastOneConnection');
  });


  it('should fail validation when agents array is empty', async () => {
    const dto = new TestConnectionsDTO();
    dto.agents = []; 
    dto.nfsConnectionDetails = new NFSConnectionDetails();
    dto.nfsConnectionDetails.userName = 'username';
    dto.nfsConnectionDetails.password = 'password';
    dto.nfsConnectionDetails.host = 'host';
    dto.nfsConnectionDetails.protocol = 'protocol';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('arrayNotEmpty');
  });

  it('should pass validation when only NFS connection details are provided', async () => {
    const dto = new TestConnectionsDTO();
    dto.agents = [new AgentDetails()];
    dto.agents[0].agentId = 'agentId';
    dto.nfsConnectionDetails = new NFSConnectionDetails();
    dto.nfsConnectionDetails.userName = 'username';
    dto.nfsConnectionDetails.password = 'password';
    dto.nfsConnectionDetails.host = 'host';
    dto.nfsConnectionDetails.protocol = 'protocol';

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should pass validation when only SMB connection details are provided', async () => {
    const dto = new TestConnectionsDTO();
    dto.agents = [new AgentDetails()];
    dto.agents[0].agentId = 'agentId';
    dto.sbmConnectionDetails = new SMBConnectionDetails();
    dto.sbmConnectionDetails.userName = 'username';
    dto.sbmConnectionDetails.password = 'password';
    dto.sbmConnectionDetails.host = 'host';
    dto.sbmConnectionDetails.protocol = 'protocol';

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});
