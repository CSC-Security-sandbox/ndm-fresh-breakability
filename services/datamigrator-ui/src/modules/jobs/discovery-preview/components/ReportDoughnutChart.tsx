import { Box } from "@components/container/index";
import { useGetReportDataQuery } from "@api/reportApi";
import { Divider } from "@mui/material";
import {
  Card,
  CardContent,
  CardTitle,
  DoughnutChart,
  MetricItemAdvance,
  CardHeader,
  Popover,
} from "@netapp/bxp-design-system-react";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { JOBS_TYPE, ReportDataPayloadType } from "@/types/app.type";
import {
  createSummaryMap,
  extractAverageMaxDepth,
  extractMaxAvgFilePath,
  extractMaxAvgFileSize,
  extractSystemFileStatAndDirectories,
  formatBytes,
  formatLargeNumber,
} from "@modules/jobs/discovery-preview/preview.decorators";
import { availableChartColors } from "@modules/jobs/discovery-preview/preview.constants";
import Legends from "@/components/chartInfo/Legends";

const colorClassMap: Record<string, string> = {
  "chart-1": "bg-blue-900",
  "chart-2": "bg-blue-400",
  "chart-3": "bg-sky-400",
  "chart-4": "bg-green-300",
  "chart-5": "bg-green-500",
  "chart-6": "bg-yellow-400",
  "chart-7": "bg-orange-300",
  "chart-8": "bg-orange-500",
  "chart-9": "bg-pink-700",
  "chart-10": "bg-purple-800",
  "chart-11": "bg-pink-300",
};

const ReportDoughnutChart = () => {
  const { jobRunId } = useParams<{ jobRunId: string }>();
  const payload: ReportDataPayloadType = {
    jobRunId: jobRunId,
    reportType: JOBS_TYPE.DISCOVERY,
  };
  const { data: reportData } = useGetReportDataQuery(payload);
  const summary = createSummaryMap(reportData);

  const fileExtensionCounts = Object.entries(summary).filter(
    ([key]) => key !== "total size (MiB)"
  );
  const totalSizeMB = summary["total size (MiB)"];

  /* This part ensures colors in the legend matches the exact 
  same colors in doughnut chart (random colors will be assigned 
  to the file extentions as this data will be dynamic) */
  const shuffledColors = [...availableChartColors]
      .filter((c) => c !== "chart-1")
      .sort(() => Math.random() - 0.5);  // Shuffle the colors

  const assignedColors: Record<string, string> = {};
  fileExtensionCounts.forEach((_, index) => {
    // Use modulo to cycle through available colors if there are more extensions than colors
    assignedColors[`chart-${index + 2}`] =
        shuffledColors[index % shuffledColors.length];
  });

// For the chart, use the actual color names directly
  const doughnutColors = [
    fileExtensionCounts.map((_, index) => `chart-${index + 2}`),
    ["chart-1"],
  ];

// For the legend, use the same direct mapping to ensure consistency
  const legendsData = [
    ...fileExtensionCounts.map(([key, value], index) => ({
      title: key,
      value,
      color: colorClassMap[`chart-${index + 2}`],
    })),
    {
      title: "Total Size (MiB)",
      value: totalSizeMB,
      color: colorClassMap["chart-1"],
    },
  ];

  const { avgDepth, maxDepth } = useMemo(
    () => extractAverageMaxDepth(reportData),
    [reportData]
  );
  const { maxPath, avgPath } = useMemo(
    () => extractMaxAvgFilePath(reportData),
    [reportData]
  );
  const { maxFileSize, avgFileSize } = useMemo(
    () => extractMaxAvgFileSize(reportData),
    [reportData]
  );
  const { directories } = useMemo(
    () => extractSystemFileStatAndDirectories(reportData),
    [reportData]
  );

  const maximumMap = [
    {
      label: `${formatLargeNumber(maxDepth)}/${formatLargeNumber(avgDepth)}`,
      value: "Depth",
    },
    {
      label: `${formatLargeNumber(maxPath)}/${formatLargeNumber(avgPath)}`,
      value: "File Path Length",
    },
  ];

  const averageMap = [
    {
      label: `${formatBytes(maxFileSize)}/${formatBytes(avgFileSize)}`,
      value: "Size",
    },
      //as it is already included in the doughnut chart, we can comment this out
    /*{
      label: `${formatLargeNumber(directories as number)}`,
      value: "Directories",
    },*/
  ];

  return (
    <Box className="flex justify-stretch gap-4">
      {/* File Extension Doughnut Chart */}
      <Card className="w-full">
        <CardHeader type="small">
          <CardTitle className="font-bold">Top File Extensions</CardTitle>
          <Popover>Top File Extensions found during discovery.</Popover>
        </CardHeader>
        <CardContent className="flex gap-8">
          <DoughnutChart
            unit=""
            label="File Summary"
            colors={doughnutColors}
            data={[
              fileExtensionCounts.map(([, value]) => value),
              [totalSizeMB],
            ]}
            value={totalSizeMB}
          />

          <Box className="flex gap-4 w-full flex-wrap max-h-60 overflow-y-auto pr-2">
            {legendsData.map((legend, index) => (
              <Legends
                key={index}
                title={legend.title}
                value={legend.value}
                color={legend.color}
                unit=""
              />
            ))}
          </Box>
        </CardContent>
      </Card>

      {/* Maximum / Average Metrics */}
      <Card className="w-full">
        <CardHeader type="small">
          <CardTitle className="font-bold">Maximum / Average</CardTitle>
          <Popover>Maximum / Average Metrics</Popover>
        </CardHeader>
        <CardContent>
          <Box className="flex justify-between p-4 pt-0">
            {maximumMap.map((item, index) => (
              <MetricItemAdvance
                key={index}
                label={item.value}
                value={item.label}
              />
            ))}
          </Box>
          <Divider orientation="horizontal" flexItem />
          <Box className="flex justify-between p-4">
            {averageMap.map((item, index) => (
              <MetricItemAdvance
                key={index}
                label={item.value}
                value={item.label}
              />
            ))}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};

export default ReportDoughnutChart;
