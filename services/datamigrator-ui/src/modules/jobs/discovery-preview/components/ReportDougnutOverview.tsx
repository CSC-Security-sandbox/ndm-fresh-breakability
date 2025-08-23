import { Box } from "@components/container/index";
import { useGetReportDataQuery } from "@api/reportApi";
import {
  Card,
  CardContent,
  DoughnutChart,
  MetricItemAdvance,
} from "@netapp/bxp-design-system-react";
import {
  FileIcon,
  FolderIcon,
} from "@netapp/bxp-design-system-react/icons/monochrome";
import { ExpandIcon, LinkIcon } from "@netapp/bxp-style/react-icons/Action";
import { useParams } from "react-router-dom";
import { JOBS_TYPE, ReportDataPayloadType } from "@/types/app.type";
import {
  extractSystemFileStatAndDirectories,
  formatBytes,
  formatLargeNumber,
} from "@modules/jobs/discovery-preview/utils/chart-data.utils";

interface ReportOverviewProps {
  Icon: any;
  iconBgColor: string;
  label: string;
  value: string | number;
}

const colorClassMap: Record<string, string> = {
  i4: "chart-4",
  i9: "chart-9",
  i3: "chart-3",
  i6: "chart-6",
};

const ReportDougnutOverview = () => {
  const { jobRunId } = useParams<{ jobRunId: string }>();
  const payload: ReportDataPayloadType = {
    jobRunId: jobRunId,
    reportType: JOBS_TYPE.DISCOVERY,
  };
  const { data: reportData } = useGetReportDataQuery(payload);

  const LegendMetric = (props: ReportOverviewProps) => (
    <MetricItemAdvance
      Icon={props.Icon}
      iconBgColor={props.iconBgColor}
      label={props.label}
      value={props.value}
    />
  );

  const {
    regularFiles,
    symbolicLinks,
    totalCount,
    totalSpaceUsed,
    directories,
  } = extractSystemFileStatAndDirectories(reportData);
  
  const overviewLegendMap = [
    {
      Icon: FolderIcon,
      iconBgColor: "i4",
      label: "Directories",
      value: formatLargeNumber(directories as number),
    },
    {
      Icon: FileIcon,
      iconBgColor: "i9",
      label: "Files",
      value: formatLargeNumber(regularFiles as number),
    },
    {
      Icon: LinkIcon,
      iconBgColor: "i3",
      label: "Symbolic links",
      value: formatLargeNumber(symbolicLinks as number),
    },
    {
      Icon: ExpandIcon,
      iconBgColor: "i6",
      label: "Total Size",
      value: formatBytes(totalSpaceUsed as number),
    },
  ];

  return (
    <Box className="mb-4">
      <Card>
        <CardContent>
          <Box className="flex gap-8 items-center">
            <DoughnutChart
              unit=""
              label="Total Items"
              colors={[["chart-6"], ["chart-4", "chart-9", "chart-3"]]}
              data={[
                [totalCount as number],
                [
                  isNaN(Number(directories)) ? 0 : Number(directories),
                  isNaN(Number(regularFiles)) ? 0 : Number(regularFiles),
                  isNaN(Number(symbolicLinks)) ? 0 : Number(symbolicLinks),
                ],
              ]}
            />
            <Box className="flex flex-col gap-2 grow">
              <Box className="flex gap-8">
                {overviewLegendMap?.map((item, index) => (
                  <LegendMetric
                    key={index}
                    Icon={item.Icon}
                    iconBgColor={colorClassMap[item.iconBgColor]}
                    label={item.label}
                    value={item.value}
                  />
                ))}
              </Box>
              {/* TODO: Commented for now to avoid confusion. Need to map values and check what is reason of empty files */}
              {/* <Box className="flex gap-8">
                <Box className="flex gap-4">
                  <Text>Empty Directories</Text>
                  <Text>0</Text>
                </Box>
                <Box className="flex gap-4">
                  <Text>Empty Files</Text>
                  <Text>0</Text>
                </Box>
              </Box> */}
            </Box>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};

export default ReportDougnutOverview;
