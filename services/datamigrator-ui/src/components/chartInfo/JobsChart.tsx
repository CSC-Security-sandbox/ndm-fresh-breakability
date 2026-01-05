import { FileServerOverviewApi } from "@/types/app.type";
import { Box } from "@components/container/index";
import {
  DoughnutChart,
} from "@netapp/bxp-design-system-react";
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

interface LegendItemProps {
  title: string;
  value: number;
  color: string;
  className?: string;
}

const JobChart = ({
  jobDetails: {
    totalDiscoverJobs,
    totalMigrateJobs,
    totalCutoverJobs,
  },
}: {
  jobDetails: FileServerOverviewApi["jobDetails"];
}) => {
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
      {totalSize.toString().length > 3 && <Tooltip>{totalSize}</Tooltip>}
      <DoughnutChart
        unit=""
        label="Total Job Configs"
        colors={
          ["chart-4", "chart-6", "chart-9"]
        }
        valueFormatter={formattedTotal}
        data={
          [totalMigrateJobs, totalDiscoverJobs, totalCutoverJobs]
        }
      />
      <Box className="flex gap-4 w-full flex-wrap items-center">
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
        <LegendWrapper
          title="Migration Jobs"
          value={totalMigrateJobs}
          color="bg-teal-500"
          unit=""
        />
      </Box>
    </>
  );
};

export default JobChart;
