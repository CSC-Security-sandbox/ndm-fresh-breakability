import { FileServerOverviewApi } from "@/types/app.type";
import { Box } from "@components/container/index";
import {
  DoughnutChart,
  MetricItemAdvance,
} from "@netapp/bxp-design-system-react";
import Divider from "@mui/material/Divider";
import LegendWrapper from "@components/chartInfo/LegendWrapper";
import { Tooltip } from "@netapp/bxp-design-system-react";
import React, { useMemo } from "react";
import {
  calculateTotal,
  formatTotal,
} from "@components/chartInfo/legends.utils";

/* 
  these are doughnut chart colors, as there is no doc, this is for reference.
  chart-1 dark blue
  chart-2 light blue
  chart-3 sky blue
  chart-4 light green
  chart-5 green
  chart-6 yellow
  chart-7 light orange
  chart-8 orange
  chart-9 dark pink
  chart-10 dark purple
  chart-11 light pink
*/

const JobChart = ({
  jobDetails: {
    totalDiscoverJobs,
    totalMigrateJobs: { baseLineJob, incrementalJob },
    totalCutoverJobs,
  },
}: {
  jobDetails: FileServerOverviewApi["jobDetails"];
}) => {
  const totalMigrateJobs = baseLineJob + incrementalJob;

  const totalSize = useMemo(() => {
    return calculateTotal([
      totalMigrateJobs,
      totalDiscoverJobs,
      totalCutoverJobs,
    ]);
  }, [totalMigrateJobs, totalDiscoverJobs, totalCutoverJobs]);

  const formattedTotal = (total: number) => formatTotal(total, "");

  return (
    <>
      <Box>
        {totalSize.toString().length > 3 && <Tooltip>{totalSize}</Tooltip>}
        <DoughnutChart
          unit=""
          label="Total Jobs"
          colors={
            ["chart-4", "chart-6", "chart-9"]
          }
          valueFormatter={formattedTotal}
          data={
            [totalMigrateJobs, totalDiscoverJobs, totalCutoverJobs]
          }
        />
      </Box>
      <Box className="flex gap-4 w-full flex-wrap">
        <LegendWrapper
          title="Discovery Jobs"
          value={totalDiscoverJobs}
          color="bg-yellow-500"
          unit=""
        />
        <LegendWrapper
          title="Cutover Jobs"
          value={totalCutoverJobs}
          color="bg-purple-500"
          unit=""
        />
        <Box className="w-4.5/12 h-1/3 flex items-baseline">
          <Box
            className={`w-6 h-6 rounded-md mx-2 bg-teal-500`}
          />
          <MetricItemAdvance
            label="Migration Jobs"
            value={baseLineJob + incrementalJob}
            unit=""
          />
        </Box>
        {/* <Box className="w-5.5/12 h-1/3 flex items-baseline">
          <Box
            className={`w-6 h-6 rounded-md mx-2 bg-blue-800`}
          />
          <MetricItemAdvance className="w-2/12" label="Baseline" value={baseLineJob} />
          <Divider orientation="vertical" flexItem style={{ margin: '0.5rem 0.5rem' }}/>
          <Box
            className={`rounded-md mx-2 bg-blue-400 w-6 h-6`}
          />
          <MetricItemAdvance className="w-2/12" label="Incremental" value={incrementalJob} />
        </Box> */}
      </Box>
    </>
  );
};

export default JobChart;
