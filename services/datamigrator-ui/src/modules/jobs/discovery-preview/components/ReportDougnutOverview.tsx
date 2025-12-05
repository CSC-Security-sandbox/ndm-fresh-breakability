import { Box } from "@components/container/index";
import { useGetReportDataQuery } from "@api/reportApi";
import {
  Card,
  CardContent,
  DoughnutChart,
  MetricItemAdvance,
  Text,
} from "@netapp/bxp-design-system-react";
import {
  FileIcon,
  FolderIcon,
} from "@netapp/bxp-design-system-react/icons/monochrome";
import { ExpandIcon, LinkIcon } from "@netapp/bxp-style/react-icons/Action";
import { ExternalLinkIcon } from "@netapp/bxp-style/react-icons/Navigation";
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
  i5: "chart-5",
  i7: "chart-7",
  i8: "chart-8",
};
 
const ReportDougnutOverview = () => {
  const { jobRunId } = useParams<{ jobRunId: string }>();
  const payload: ReportDataPayloadType = {
    jobRunId: jobRunId,
    reportType: JOBS_TYPE.DISCOVERY,
  };
  const { data: reportData } = useGetReportDataQuery(payload);
 
  const dataItems = reportData?.data?.items || reportData || [];
 
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
    junctionCount,
    volumeMountCount,
    hardLinks,
    totalCount,
    totalSpaceUsed,
    directories,
    fileServerProtocol,
  } = extractSystemFileStatAndDirectories(dataItems);
 
  const protocolString = String(fileServerProtocol || '').toUpperCase().trim();
  const isSMBProtocol = protocolString === "SMB";
 
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
      Icon: ExpandIcon,
      iconBgColor: "i6",
      label: "Total Size",
      value: formatBytes(totalSpaceUsed as number),
    },
  ];
 
  const linkDetailsMap = [
    {
      Icon: LinkIcon,
      iconBgColor: "i3",
      label: "Symbolic links",
      value: formatLargeNumber(symbolicLinks as number),
      show: true,
    },
    {
      Icon: LinkIcon,
      iconBgColor: "i8",
      label: "Hard Links",
      value: formatLargeNumber(hardLinks as number),
      show: true,
    },
    {
      Icon: ExternalLinkIcon,
      iconBgColor: "i5",
      label: "Junctions",
      value: formatLargeNumber(junctionCount as number),
      show: isSMBProtocol,
    },
    {
      Icon: ExternalLinkIcon,
      iconBgColor: "i7",
      label: "Volume Mount Points",
      value: formatLargeNumber(volumeMountCount as number),
      show: isSMBProtocol,
    },
  ];
 
  const showLinkDetailsCard = true;
 
  return (
    <Box className="mb-4 space-y-4">
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
              <Box className="flex gap-8 flex-wrap">
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
 
      {showLinkDetailsCard && (
        <Card>
          <CardContent>
            <Box className="flex flex-col gap-2 grow">
              <Box className="flex items-center gap-2 mb-2">
                <LinkIcon className="w-4 h-4" />
                <Text className="font-semibold">
                  Redirects
                </Text>
              </Box>
              <Box
                className="grid gap-8"
                style={{
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gridTemplateRows: '1fr'
                }}
              >
                {linkDetailsMap.map((item, index) => (
                  <Box
                    key={index}
                    style={{ gridColumn: index + 1 }}
                  >
                    {item.show && (
                      <LegendMetric
                        Icon={item.Icon}
                        iconBgColor={colorClassMap[item.iconBgColor]}
                        label={item.label}
                        value={item.value}
                      />
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};
 
export default ReportDougnutOverview;

