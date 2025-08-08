/**
 * Event Loop Monitoring Script
 * Run this to track if the configuration fetch timeouts are resolved
 */

import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class EventLoopMonitor {
  private configFetchAttempts = 0;
  private configFetchSuccesses = 0;
  private configFetchTimeouts = 0;

  constructor(private readonly httpService: HttpService) {}

  /**
   * Test configuration fetching under load
   */
  async testConfigFetchReliability(
    configUrl: string,
    accessToken: string,
    platform: string,
    testDurationMs: number = 60000 // 1 minute test
  ): Promise<void> {
    console.log('🔍 Starting Event Loop Configuration Fetch Test...');
    console.log(`📊 Test Duration: ${testDurationMs / 1000}s`);
    console.log(`🎯 Target: ${configUrl}`);
    
    const startTime = Date.now();
    this.resetCounters();

    // Test configuration fetches every 5 seconds
    const testInterval = setInterval(async () => {
      if (Date.now() - startTime > testDurationMs) {
        clearInterval(testInterval);
        this.printResults();
        return;
      }

      await this.attemptConfigFetch(configUrl, accessToken, platform);
    }, 5000);

    // Also test HTTP responsiveness during the test
    this.startHttpResponsivenessTest();
  }

  private async attemptConfigFetch(
    configUrl: string,
    accessToken: string,
    platform: string
  ): Promise<void> {
    this.configFetchAttempts++;
    const attemptStart = Date.now();

    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${configUrl}/api/v1/work-manager/config`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'x-client-platform': platform,
            },
            timeout: 15000,
          },
        ),
      );

      if (response.status === 200) {
        const duration = Date.now() - attemptStart;
        this.configFetchSuccesses++;
        console.log(`✅ Config fetch ${this.configFetchAttempts}: SUCCESS (${duration}ms)`);
      }
    } catch (error) {
      const duration = Date.now() - attemptStart;
      if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
        this.configFetchTimeouts++;
        console.log(`❌ Config fetch ${this.configFetchAttempts}: TIMEOUT (${duration}ms)`);
      } else {
        console.log(`⚠️  Config fetch ${this.configFetchAttempts}: ERROR - ${error.message} (${duration}ms)`);
      }
    }
  }

  private startHttpResponsivenessTest(): void {
    let httpTests = 0;
    let httpSuccesses = 0;

    const httpInterval = setInterval(() => {
      httpTests++;
      const start = Date.now();

      // Test a simple HTTP request to measure event loop responsiveness
      setImmediate(() => {
        const delay = Date.now() - start;
        if (delay < 100) {
          httpSuccesses++;
          console.log(`🟢 HTTP responsiveness test ${httpTests}: ${delay}ms (GOOD)`);
        } else {
          console.log(`🔴 HTTP responsiveness test ${httpTests}: ${delay}ms (SLOW - event loop may be blocked)`);
        }
      });
    }, 2000);

    // Stop after test duration
    setTimeout(() => {
      clearInterval(httpInterval);
      console.log(`📈 HTTP Responsiveness: ${httpSuccesses}/${httpTests} tests under 100ms`);
    }, 60000);
  }

  private resetCounters(): void {
    this.configFetchAttempts = 0;
    this.configFetchSuccesses = 0;
    this.configFetchTimeouts = 0;
  }

  private printResults(): void {
    console.log('\n🎯 TEST RESULTS:');
    console.log(`📊 Total Attempts: ${this.configFetchAttempts}`);
    console.log(`✅ Successes: ${this.configFetchSuccesses}`);
    console.log(`❌ Timeouts: ${this.configFetchTimeouts}`);
    console.log(`📈 Success Rate: ${((this.configFetchSuccesses / this.configFetchAttempts) * 100).toFixed(1)}%`);
    console.log(`🔥 Timeout Rate: ${((this.configFetchTimeouts / this.configFetchAttempts) * 100).toFixed(1)}%`);

    if (this.configFetchTimeouts === 0) {
      console.log('🎉 EXCELLENT: No timeouts detected! Event loop blocking issue resolved.');
    } else if (this.configFetchTimeouts < this.configFetchAttempts * 0.1) {
      console.log('👍 GOOD: Low timeout rate. Event loop blocking significantly improved.');
    } else {
      console.log('⚠️  WARNING: High timeout rate. Event loop blocking still occurring.');
    }
  }

  /**
   * Check current event loop lag
   */
  measureEventLoopLag(): Promise<number> {
    return new Promise((resolve) => {
      const start = process.hrtime.bigint();
      setImmediate(() => {
        const end = process.hrtime.bigint();
        const lagMs = Number((end - start) / BigInt(1000000));
        resolve(lagMs);
      });
    });
  }

  /**
   * Continuous event loop monitoring
   */
  async startContinuousMonitoring(): Promise<void> {
    console.log('🔄 Starting continuous event loop monitoring...');
    
    setInterval(async () => {
      const lag = await this.measureEventLoopLag();
      const timestamp = new Date().toISOString();
      
      if (lag > 100) {
        console.log(`⚠️  [${timestamp}] Event loop lag: ${lag}ms (HIGH - potential blocking)`);
      } else if (lag > 50) {
        console.log(`🟡 [${timestamp}] Event loop lag: ${lag}ms (MODERATE)`);
      } else {
        console.log(`🟢 [${timestamp}] Event loop lag: ${lag}ms (GOOD)`);
      }
    }, 5000);
  }
}

export default EventLoopMonitor;
