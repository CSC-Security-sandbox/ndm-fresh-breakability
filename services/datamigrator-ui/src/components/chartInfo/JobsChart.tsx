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

interface LegendItemProps {
	    title: string;
	    value: number;
	    color: string;
	    className?: string;
	  }
	

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

  // Custom legend item component to reduce repetition
  const LegendItem = ({ title, value, color, className = "" }: LegendItemProps) => (
    <Box className={`flex items-baseline ${className}`}>
      <Box className={`w-6 h-6 rounded-md mx-2 ${color}`} />
      <MetricItemAdvance label={title} value={value} unit="" />
    </Box>
  );

  return (
    <>
      {totalSize.toString().length > 3 && <Tooltip>{totalSize}</Tooltip>}
      <DoughnutChart
        unit=""
        label="Total Jobs"
        colors={[
          ["chart-4", "chart-6", "chart-9"],
          ["chart-1", "chart-2", "chart-6", "chart-9"],
        ]}
        valueFormatter={formattedTotal}
        data={[
          [totalMigrateJobs, totalDiscoverJobs, totalCutoverJobs],
          [baseLineJob, incrementalJob, totalDiscoverJobs, totalCutoverJobs],
        ]}
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

        <Box className="flex items-center gap-2">
          <LegendItem
            title="Migration Jobs"
            value={totalMigrateJobs}
            color="bg-teal-500"
          />

          <LegendItem
            title="Baseline"
            value={baseLineJob}
            color="bg-blue-800"
          />

          <Divider
            orientation="vertical"
            flexItem
            style={{ margin: "0.5rem 0.5rem" }}
          />

          <LegendItem
            title="Incremental"
            value={incrementalJob}
            color="bg-blue-400"
          />
        </Box>
      </Box>
    </>
  );
};

export default JobChart;
