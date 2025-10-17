import { formatDateToYMD } from "@/utils/dateFormatter";

// Checks if a value is a valid date
export const isValidDate = (value: any): boolean => {
  if (!value || value === null || value === undefined) return false;
  return value instanceof Date || !isNaN(Date.parse(value));
};

// Checks if a date is in the future
export const isDateInFuture = (value: any): boolean => {
  if (!isValidDate(value)) return false;

  const selectedDate = new Date(value);
  const today = new Date();

  // Compare only dates, not time
  selectedDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  return selectedDate > today;
};

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

export const extractProjectAndWorkerNames = (
  projectWorkerMap: any[],
  allProjectWorkerData: any[]
) => {
  if (!projectWorkerMap || !Array.isArray(projectWorkerMap)) {
    return {
      projectNames: [],
      workerNames: [],
    };
  }

  const projectNames: string[] = [];
  const workerNames: string[] = [];

  projectWorkerMap.forEach((item) => {
    const { projectId, workerIds } = item;

    // Find project in the tree structure
    const projectData = allProjectWorkerData.find(
      (project) => project.id === projectId
    );

    if (!projectData) return;

    // ALWAYS add the project name (whether workers are selected or not)
    if (!projectNames.includes(projectData.label)) {
      projectNames.push(projectData.label);
    }

    // If specific workers are selected, also add worker names
    if (workerIds && workerIds.length > 0) {
      workerIds.forEach((workerId: string) => {
        const workerData = projectData.childrens?.find(
          (worker: any) => worker.id === workerId
        );

        if (workerData) {
          workerNames.push(workerData.label);
        }
      });
    }
  });

  const result = {
    projectNames,
    workerNames,
  };

  return result;
};

export const createSupportBundleInfoMessage = (
  startDate: Date | null,
  endDate: Date | null,
  projectNames: string[],
  workerNames: string[],
  transformedMetrics: any[]
) => {
  console.log("Input data:", {
    startDate,
    endDate,
    projectNames,
    workerNames,
    transformedMetrics,
  });

  const result = {
    date: "",
    projects: "",
    workers: "",
    metrics: "",
  };

  if (startDate && endDate) {
    result.date = `Date: ${formatDateToYMD(startDate)} to ${formatDateToYMD(
      endDate
    )}`;
  }

  if (projectNames && projectNames.length > 0) {
    result.projects = `Projects: ${projectNames.join(", ")}`;
  }

  if (workerNames && workerNames.length > 0) {
    result.workers = `Workers: ${workerNames.join(", ")}`;
  }

  if (transformedMetrics && transformedMetrics.length > 0) {
    const metricsLabels = transformedMetrics.map((metric: any) => metric.label);
    result.metrics = `Other Metrics: ${metricsLabels.join(", ")}`;
  }

  return result;
};
