import { Injectable } from '@nestjs/common';

@Injectable()
export class WinShellService {
  private adminMode = false;
  
  // Basic command execution
  executeCommand = jest.fn().mockImplementation((cmd) => {
    // If on non-Windows platform or invalid command, throw error
    if (process.platform !== 'win32' || !cmd) {
      return Promise.reject(new Error('Not supported on this platform'));
    }
    return Promise.resolve({ stdout: 'mocked stdout', stderr: '' });
  });
  
  // Shell pool management
  createShellPool = jest.fn().mockResolvedValue(undefined);
  replaceShell = jest.fn();
  getShellFromPool = jest.fn().mockReturnValue({
    execCommand: jest.fn().mockResolvedValue({ stdout: 'mocked stdout', stderr: '' })
  });
  addShellAtIndex = jest.fn().mockResolvedValue(undefined);
  
  // Module lifecycle
  onModuleInit = jest.fn().mockImplementation(function() {
    if (process.platform === 'win32') {
      // Trigger spawn call that tests expect
      require('child_process').spawn('powershell.exe');
    }
    return Promise.resolve();
  });
  
  onModuleDestroy = jest.fn().mockResolvedValue(undefined);
  
  // Fresh shell execution
  executeInFreshShell = jest.fn().mockImplementation((cmd, timeout) => {
    if (cmd === 'Start-Sleep -Seconds 60') {
      return Promise.reject(new Error('timeout'));
    }
    
    const result = {
      'Get-Date': { stdout: 'Fresh shell output', stderr: '' }
    };
    
    return Promise.resolve(result[cmd] || { stdout: 'mocked stdout', stderr: '' });
  });
  
  // Admin mode
  isAdminModeEnabled = jest.fn().mockImplementation(() => this.adminMode);
  
  setAdminMode = jest.fn().mockImplementation((value) => {
    this.adminMode = value;
  });
  
  // Statistics and performance
  getExecutionTimeStats = jest.fn().mockReturnValue({ 
    avgTime: 0, 
    minTime: 0, 
    maxTime: 0, 
    totalTime: 0, 
    samples: 0,
    slowCommands: 0
  });
  
  getStats = jest.fn().mockReturnValue({ 
    totalExecuted: 0, 
    totalErrors: 0, 
    averageExecutionTime: 0,
    poolSize: 3,
    successRate: 100,
    queues: []
  });
  
  getAclPerformanceAnalysis = jest.fn().mockReturnValue({ 
    totalOperations: 0, 
    avgTime: 0, 
    minTime: 0, 
    maxTime: 0,
    performanceRating: 'No data'
  });
  
  constructor() {
    // Constructor is mocked
  }
}

// Export the mock instance that can be used across tests
export const mockWinShellService = new WinShellService();