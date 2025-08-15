export const buildProjectWorkerMap = (
  formData: Record<string, any>,
  projectWorkerData: Record<string, any>[]
) => {
  const selectedProjectIds = new Set();
  const selectedWorkerIds = new Set();

  if (!Array.isArray(formData?.projectWorker)) {
    return [];
  }

  formData?.projectWorker.forEach(({ id, childrens }) => {
    if (childrens) {
      selectedProjectIds.add(id);
    } else {
      selectedWorkerIds.add(id);
    }
  });

  return projectWorkerData
    .map((project) => {
      const mapping: { projectId?: string; workerIds?: string[] } = {};

      if (selectedProjectIds.has(project.id)) {
        mapping.projectId = project?.id;
      }

      if (project?.childrens && selectedWorkerIds.size > 0) {
        const matchedWorkers = project?.childrens
          .filter((worker: Record<string, string>) =>
            selectedWorkerIds.has(worker?.id)
          )
          .map((worker: Record<string, string>) => worker?.id);

        if (matchedWorkers?.length > 0) {
          mapping.workerIds = matchedWorkers;
        }
      }

      return mapping;
    })
    .filter((mapping) => Object.keys(mapping)?.length > 0);
};
