export const createWorkerQuery = (
  baseQuery: string,
  workerId: string,
): string => {
  return baseQuery.replace(/\$worker/g, workerId);
};

export const createWorkerQueriesForMultipleWorkers = (
  baseQuery: string,
  workerIds: string[],
): string => {
  if (workerIds.length === 0 || !baseQuery.includes('$worker')) {
    return baseQuery;
  }

  const workerIdRegex = workerIds.join('|');
  const workerJobRegex = workerIds.map((id) => `worker-${id}`).join('|');

  return baseQuery
    .replace(/job="worker-\$worker"/g, `job=~"${workerJobRegex}"`)
    .replace(/worker_id="\$worker"/g, `worker_id=~"${workerIdRegex}"`)
    .replace(/\$worker/g, `(${workerIdRegex})`);
};
