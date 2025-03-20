const { parentPort, workerData } = require('worker_threads');

// Example task processing logic
const processTask = (data) => {
    console.log('Processing task:', data);
    // Simulate task processing
    return { success: true, data };
};

// Listen for messages from the main thread
parentPort.on('message', (task) => {
    try {
        const result = processTask(task);
        parentPort.postMessage(result); // Send the result back to the main thread
    } catch (error) {
        parentPort.postMessage({ success: false, error: error.message });
    }
});

// Start processing the task passed in workerData
if (workerData) {
    const result = processTask(workerData);
    parentPort.postMessage(result);
}