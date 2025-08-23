import { Box } from "@components/container/index";
import { useGetReportDataQuery } from "@api/reportApi";
import {
  Card,
  CardContent,
  MetricItemAdvance,
  Text,
  WidgetDivider,
} from "@netapp/bxp-design-system-react";
import { SuccessIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { useParams } from "react-router-dom";
import { JOBS_TYPE, ReportDataPayloadType } from "@/types/app.type";
import { extractSystemFileStatAndDirectories } from "@modules/jobs/discovery-preview/utils/chart-data.utils";

const ReportHeader = () => {
  const { jobRunId } = useParams<{ jobRunId: string }>();
  const payload: ReportDataPayloadType = {
    jobRunId: jobRunId,
    reportType: JOBS_TYPE.DISCOVERY,
  };
  const { data: reportData } = useGetReportDataQuery(payload);

  const {
    fileServerName,
    fileServerPath,
    fileServerProtocol,
    scanTime,
    jobRunStatus,
  } = extractSystemFileStatAndDirectories(reportData);

  const jobRunHeaderDetails = [
    {
      label: "Job Run Id",
      value: jobRunId,
    },
    {
      label: "File Server",
      value: fileServerName,
    },
    {
      label: "Path",
      value: fileServerPath,
    },
    {
      label: "Report Status",
      value:
        jobRunStatus === "Completed" ? "Completed (0 errors)" : jobRunStatus,
    },
    {
      label: "Scan Time",
      value: scanTime,
    },
    {
      label: "Scan Protocol",
      value: fileServerProtocol,
    },
  ];

  return (
    <Box>
      <Card className="mb-4">
        <CardContent>
          <Box className="flex justify-between gap-4">
            {jobRunHeaderDetails.map((metric, key) => (
              <>
                <Box>
                  {metric.label == "Report Status" &&
                  metric.value == "COMPLETED" ? (
                    <>
                      <MetricItemAdvance
                        label={metric.label}
                        value={"Completed (0 errors)"}
                        ValueIcon={SuccessIcon}
                        valueIconColor="success"
                      />
                    </>
                  ) : (
                    <>
                      <Text bold>{metric.value}</Text>
                      <Text>{metric.label}</Text>
                    </>
                  )}
                </Box>
                {key + 1 !== jobRunHeaderDetails.length && (
                  <Box className="">
                    <WidgetDivider expand />
                  </Box>
                )}
              </>
            ))}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};

export default ReportHeader;
