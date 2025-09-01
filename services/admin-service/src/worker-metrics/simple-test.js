#!/usr/bin/env node

/**
 * Dynamic worker metrics query tool
 * Usage: node simple-test.js <control_plane_ip> <worker_id>
 * Example: node simple-test.js 172.30.203.35 0b02b6ea-7771-4fa3-b42a-7441261c7425
 */

const http = require('http');

// Parse command line arguments
const args = process.argv.slice(2);

// Function to show usage
function showUsage() {
  console.log('🔧 NDM Worker Metrics Query Tool');
  console.log('');
  console.log('Usage:');
  console.log('  node simple-test.js <control_plane_ip> <worker_id>');
  console.log('');
  console.log('Arguments:');
  console.log('  control_plane_ip  The IP address of the NDM control plane');
  console.log('  worker_id         The UUID of the worker to query metrics for');
  console.log('');
  console.log('Example:');
  console.log('  node simple-test.js 172.30.203.35 0b02b6ea-7771-4fa3-b42a-7441261c7425');
  console.log('');
  console.log('Automated Features:');
  console.log('   Automatically fetches kubeconfig via SSH if not found');
  console.log('   Validates Kubernetes connectivity');
  console.log('   Checks for Prometheus service availability');
  console.log('   Sets up port-forwarding to Prometheus');
  console.log('   Queries worker metrics and formats results');
  console.log('');
  console.log('Prerequisites:');
  console.log('  - SSH access to control plane (ubuntu@<control_plane_ip>)');
  console.log('  - sudo privileges on control plane');
  console.log('  - microk8s running on control plane');
  console.log('  - Prometheus installed in "prometheus" namespace');
  console.log('');
  console.log('Kubeconfig Location:');
  console.log('  ~/.kube/ndm-cluster-config-<control_plane_ip_with_dashes>');
  console.log('');
}

// Validate arguments
if (args.length !== 2 || args.includes('--help') || args.includes('-h')) {
  showUsage();
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

const CONTROL_PLANE_IP = args[0];
const WORKER_ID = args[1];
const PROMETHEUS_BASE_URL = 'http://localhost:9090/api/v1';

// Validate IP format (basic validation)
const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
if (!ipRegex.test(CONTROL_PLANE_IP)) {
  console.error(' Invalid IP address format:', CONTROL_PLANE_IP);
  process.exit(1);
}

// Validate UUID format (basic validation)
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!uuidRegex.test(WORKER_ID)) {
  console.error(' Invalid worker ID format (expected UUID):', WORKER_ID);
  process.exit(1);
}

// Construct kubeconfig path dynamically
const kubeconfigPath = `${process.env.HOME}/.kube/ndm-cluster-config-${CONTROL_PLANE_IP.replace(/\./g, '-')}`;

// Function to make HTTP request to Prometheus
function queryPrometheus(query) {
  return new Promise((resolve, reject) => {
    const url = `${PROMETHEUS_BASE_URL}/query?query=${encodeURIComponent(query)}`;
    
    http.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve(jsonData);
        } catch (error) {
          reject(new Error(`Failed to parse JSON: ${error.message}`));
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function testWorkerMetrics() {
  console.log(' QUERYING WORKER METRICS');
  console.log(` Prometheus URL: ${PROMETHEUS_BASE_URL}`);
  console.log('');

  try {
    // Test Prometheus connectivity
    console.log(' Testing Prometheus connectivity...');
    const upResponse = await queryPrometheus('up');
    console.log(` Prometheus accessible, found ${upResponse.data.result.length} targets`);
    
    // Query worker memory metrics
    console.log('\n Querying worker memory metrics...');
    const memoryQuery = `worker_system_memory{worker_id="${WORKER_ID}"}`;
    console.log(` Query: ${memoryQuery}`);
    
    const memoryResponse = await queryPrometheus(memoryQuery);
    
    if (memoryResponse.status === 'success' && memoryResponse.data.result.length > 0) {
      console.log(` Found ${memoryResponse.data.result.length} memory metrics:`);
      
      let memoryData = {
        total: 0,
        used: 0,
        free: 0,
        usagePercent: 0
      };
      
      memoryResponse.data.result.forEach((result, index) => {
        const type = result.metric.type;
        const value = parseFloat(result.value[1]);
        
        console.log(`   ${index + 1}. Type: ${type}, Value: ${value}`);
        
        // Collect memory data
        switch (type) {
          case 'total':
            memoryData.total = value;
            break;
          case 'used':
            memoryData.used = value;
            break;
          case 'free':
            memoryData.free = value;
            break;
          case 'usage_percent':
            memoryData.usagePercent = value;
            break;
        }
      });
      
      // Display formatted results
      console.log('\n MEMORY SUMMARY:');
      if (memoryData.total > 0) {
        console.log(`   Total Memory: ${formatBytes(memoryData.total)}`);
      }
      if (memoryData.used > 0) {
        console.log(`   Used Memory: ${formatBytes(memoryData.used)}`);
      }
      if (memoryData.free > 0) {
        console.log(`   Free Memory: ${formatBytes(memoryData.free)}`);
      }
      if (memoryData.usagePercent > 0) {
        console.log(`   Usage Percent: ${memoryData.usagePercent.toFixed(2)}%`);
        console.log(`\n🎯 Worker memory used is: ${memoryData.usagePercent}`);
      }
      
    } else {
      console.log(' No memory metrics found for worker');
      console.log(' Response:', JSON.stringify(memoryResponse, null, 2));
    }
    
    // Test CPU metrics
    console.log('\n  Querying worker CPU metrics...');
    const cpuQuery = `worker_system_cpu_usage{worker_id="${WORKER_ID}"}`;
    const cpuResponse = await queryPrometheus(cpuQuery);
    
    if (cpuResponse.status === 'success' && cpuResponse.data.result.length > 0) {
      console.log(` Found ${cpuResponse.data.result.length} CPU metrics`);
      cpuResponse.data.result.slice(0, 3).forEach((result, index) => {
        const core = result.metric.core || 'unknown';
        const value = parseFloat(result.value[1]);
        console.log(`   ${index + 1}. Core: ${core}, Usage: ${value.toFixed(2)}%`);
      });
    } else {
      console.log(' No CPU metrics found');
    }
    
    console.log('\n Query completed successfully!');
    
  } catch (error) {
    console.error(' Query failed:', error.message);
  }
}

// Set up port forwarding first
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Function to execute shell commands with promise
function execCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: 30000, ...options }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Command failed: ${command}\nError: ${error.message}\nStderr: ${stderr}`));
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

// Function to fetch kubeconfig from control plane
async function fetchKubeconfig() {
  console.log(' Fetching kubeconfig from control plane...');
  
  try {
    // Ensure the .kube directory exists
    const kubeDir = path.dirname(kubeconfigPath);
    if (!fs.existsSync(kubeDir)) {
      fs.mkdirSync(kubeDir, { recursive: true });
      console.log(` Created directory: ${kubeDir}`);
    }
    
    // Extract the last part of IP for kubeconfig naming (e.g., 172.30.203.35 -> 35)
    const ipSuffix = CONTROL_PLANE_IP.split('.').pop();
    const sshCommand = `ssh ubuntu@${CONTROL_PLANE_IP} "sudo microk8s config"`;
    
    console.log(` Executing: ssh ubuntu@${CONTROL_PLANE_IP} "sudo microk8s config"`);
    const { stdout } = await execCommand(sshCommand);
    
    // Write kubeconfig to file
    fs.writeFileSync(kubeconfigPath, stdout);
    console.log(` Kubeconfig saved to: ${kubeconfigPath}`);
    
    return true;
  } catch (error) {
    console.error(` Failed to fetch kubeconfig: ${error.message}`);
    console.error(' Make sure:');
    console.error('   - SSH access to control plane is configured');
    console.error('   - microk8s is running on the control plane');
    console.error('   - You have sudo privileges on the control plane');
    return false;
  }
}

// Function to validate Kubernetes connectivity
async function validateKubernetesConnection() {
  console.log(' Validating Kubernetes connection...');
  
  try {
    // Test basic connectivity
    console.log(' Getting nodes...');
    const nodesResult = await execCommand(`kubectl --kubeconfig ${kubeconfigPath} get nodes --no-headers`);
    const nodeCount = nodesResult.stdout.split('\n').filter(line => line.trim()).length;
    console.log(` Found ${nodeCount} nodes`);
    
    // Check namespaces
    console.log(' Checking namespaces...');
    const namespacesResult = await execCommand(`kubectl --kubeconfig ${kubeconfigPath} get namespaces --no-headers`);
    const namespaceCount = namespacesResult.stdout.split('\n').filter(line => line.trim()).length;
    console.log(` Found ${namespaceCount} namespaces`);
    
    // Look for Prometheus services
    console.log(' Looking for Prometheus services...');
    const servicesResult = await execCommand(`kubectl --kubeconfig ${kubeconfigPath} get svc --all-namespaces | grep -E "(prometheus|monitoring|metrics)" || echo "No prometheus services found"`);
    
    if (servicesResult.stdout.includes('prometheus-server')) {
      console.log(' Found Prometheus server service');
      
      // Check if prometheus namespace exists and has pods
      const prometheusPodsResult = await execCommand(`kubectl --kubeconfig ${kubeconfigPath} get pods -n prometheus --no-headers 2>/dev/null || echo "No prometheus namespace"`);
      if (!prometheusPodsResult.stdout.includes('No prometheus namespace')) {
        const podCount = prometheusPodsResult.stdout.split('\n').filter(line => line.trim()).length;
        console.log(` Found ${podCount} pods in prometheus namespace`);
      }
    } else {
      console.warn('  Prometheus service not found. Port forwarding may fail.');
      console.log(' Available services:', servicesResult.stdout);
    }
    
    return true;
  } catch (error) {
    console.error(` Kubernetes validation failed: ${error.message}`);
    return false;
  }
}

async function setupPortForward() {
  return new Promise((resolve, reject) => {
    console.log(' Setting up port forwarding to Prometheus...');
    console.log(` Using kubeconfig: ${kubeconfigPath}`);
    console.log(` Control plane: ${CONTROL_PLANE_IP}`);
    
    const portForwardProcess = spawn('kubectl', [
      '--kubeconfig', kubeconfigPath,
      'port-forward',
      'svc/prometheus-server',
      '9090:80',
      '-n', 'prometheus'
    ]);
    
    let isReady = false;
    let hasError = false;
    
    portForwardProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(` ${output.trim()}`);
      
      if (output.includes('Forwarding from') && !isReady) {
        isReady = true;
        console.log(' Port forwarding established!\n');
        
        setTimeout(() => {
          resolve(portForwardProcess);
        }, 1000);
      }
    });
    
    portForwardProcess.stderr.on('data', (data) => {
      const errorOutput = data.toString().trim();
      console.error(` ${errorOutput}`);
      
      if (errorOutput.includes('not found') || errorOutput.includes('No such')) {
        hasError = true;
        console.error(' Prometheus service not found. Please check:');
        console.error('   - Prometheus is installed in the prometheus namespace');
        console.error('   - Service name is "prometheus-server"');
        console.error('   - Run: kubectl --kubeconfig ' + kubeconfigPath + ' get svc -n prometheus');
      }
    });
    
    portForwardProcess.on('close', (code) => {
      if (code !== 0 && !isReady) {
        reject(new Error(`Port forwarding process exited with code ${code}`));
      }
    });
    
    setTimeout(() => {
      if (!isReady && !hasError) {
        portForwardProcess.kill();
        reject(new Error('Port forwarding timeout - no response after 10 seconds'));
      } else if (hasError) {
        portForwardProcess.kill();
        reject(new Error('Port forwarding failed due to service not found'));
      }
    }, 10000);
  });
}

async function main() {
  let portForwardProcess = null;
  
  try {
    console.log(' NDM Worker Metrics Query Tool');
    console.log('=====================================');
    console.log(`Control Plane IP: ${CONTROL_PLANE_IP}`);
    console.log(` Worker ID: ${WORKER_ID}`);
    console.log(` Expected Kubeconfig: ${kubeconfigPath}`);
    console.log('');
    
    // Check if kubeconfig file exists, if not fetch it
    if (!fs.existsSync(kubeconfigPath)) {
      console.log(' Kubeconfig file not found');
      console.log(' Attempting to fetch kubeconfig automatically...');
      
      const fetchSuccess = await fetchKubeconfig();
      if (!fetchSuccess) {
        console.error('� Failed to fetch kubeconfig. Exiting.');
        process.exit(1);
      }
    } else {
      console.log(' Kubeconfig file found');
    }
    
    // Validate Kubernetes connection
    console.log('');
    const validationSuccess = await validateKubernetesConnection();
    if (!validationSuccess) {
      console.error('💥 Kubernetes validation failed. Exiting.');
      process.exit(1);
    }
    
    console.log('');
    
    // Setup port forwarding
    portForwardProcess = await setupPortForward();
    
    // Run metrics query
    await testWorkerMetrics();
    
  } catch (error) {
    console.error(' Main error:', error.message);
    process.exit(1);
  } finally {
    if (portForwardProcess) {
      console.log('\n🧹 Cleaning up...');
      portForwardProcess.kill();
    }
  }
}

main();
