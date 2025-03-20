const { parentPort, workerData } = require('worker_threads');

function processData(jobRunId) {
    parentPort.postMessage(`Processing job: ${jobRunId}`);
    setTimeout(() => processData(jobRunId), 5000);
}

processData(workerData.jobRunId);