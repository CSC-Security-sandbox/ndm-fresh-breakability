// Jest global setup and teardown hooks for handling open handles

// Monkey-patch setTimeout to ensure all timeouts are unref'd
const originalSetTimeout = global.setTimeout;
global.setTimeout = function(callback, ms, ...args) {
  const timeoutId = originalSetTimeout(callback, ms, ...args);
  if (timeoutId.unref) {
    timeoutId.unref();
  }
  return timeoutId;
};

// Force Node.js to exit after tests complete if there are still open handles
afterAll(async () => {
  // Add a small delay to allow async operations to complete
  await new Promise(resolve => {
    setTimeout(resolve, 500);
  });
  
  // Only use this in CI environments or when --forceExit isn't available
//   if (process.env.CI || process.argv.includes('--detectOpenHandles')) {
//     console.log('Gracefully exiting Jest after tests complete');
//     setTimeout(() => {
//       process.exit(0);
//     }, 1000);
//   }
}, 5000);