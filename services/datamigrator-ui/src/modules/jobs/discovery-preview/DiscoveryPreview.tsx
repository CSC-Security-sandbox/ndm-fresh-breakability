import { Box } from "@components/container/index";
import {
  useDownloadReportsMutation,
  useGetPdfReportMutation,
  useGetReportDataQuery,
} from "@api/reportApi";
import {
  ActionMenu,
  ActionMenuButtonStyle,
  DropdownButton,
} from "@netapp/bxp-design-system-react";
import { useParams } from "react-router-dom";
import GraphLoader from "@modules/jobs/discovery-preview/components/GraphLoader";
import Graphs from "@modules/jobs/discovery-preview/components/Graphs";
import ReportDoughnutChart from "@modules/jobs/discovery-preview/components/ReportDoughnutChart";
import ReportDougnutOverview from "@modules/jobs/discovery-preview/components/ReportDougnutOverview";
import ReportHeader from "@modules/jobs/discovery-preview/components/ReportHeader";
import ReportTables from "@modules/jobs/discovery-preview/components/ReportTables";
import { JOBS_TYPE, ReportDataPayloadType } from "@/types/app.type";
import { handleDownloadReport } from "@modules/jobs/jobs.utils";
import { notify } from "@components/notification/NotificationWrapper";
import ChartError from "@components/chartInfo/ChartError";
import { Card, CardContent } from "@netapp/bxp-design-system-react";
import { useEffect } from "react";
import { Show } from "@components/show/Show";

const DiscoveryPreview = () => {
  const { jobRunId } = useParams<{ jobRunId: string }>();
  const payload: ReportDataPayloadType = {
    jobRunId: jobRunId,
    reportType: JOBS_TYPE.DISCOVERY,
  };
  const { isFetching: reportDataIsLoading, isError } =
    useGetReportDataQuery(payload);

  const [downloadReports] = useDownloadReportsMutation();
  const [getPdfReport] = useGetPdfReportMutation();

  const handleCsv = async () => {
    try {
      await handleDownloadReport(
        downloadReports,
        jobRunId,
        JOBS_TYPE.DISCOVERY,
        "CSV"
      );
    } catch (error) {
      console.error("Error downloading CSV report:", error);
      notify.error("Failed to download the CSV report. Please try again.");
    }
  };

  const handlePdf = async () => {
    try {
      await handleDownloadReport(
        getPdfReport,
        jobRunId,
        JOBS_TYPE.DISCOVERY,
        "PDF"
      );
    } catch (error) {
      console.error("Error downloading PDF report:", error);
      notify.error("Failed to download the PDF report. Please try again.");
    }
  };

  useEffect(() => {
    if (isError) {
      notify.error("Failed to fetch the discovery report.");
    }
  }, [isError]);

  return (
    <Box>
      <Box className="flex justify-end mb-4">
        <ActionMenuButtonStyle
          button={<DropdownButton>Download Discovery Report</DropdownButton>}
        >
          <ActionMenu.Button
            onClick={() => {
              handleCsv();
            }}
          >
            Download as CSV
          </ActionMenu.Button>
          <ActionMenu.Button
            onClick={() => {
              handlePdf();
            }}
          >
            Download as PDF
          </ActionMenu.Button>
        </ActionMenuButtonStyle>
      </Box>
      <Show>
        <Show.When isTrue={isError}>
          <Card>
            <CardContent>
              <ChartError>Failed to fetch the discovery report</ChartError>
            </CardContent>
          </Card>
        </Show.When>
        <Show.Else>
          <GraphLoader label="Report Header" isLoading={reportDataIsLoading}>
            <ReportHeader />
          </GraphLoader>

          <GraphLoader label="Report Overview" isLoading={reportDataIsLoading}>
            <ReportDougnutOverview />
          </GraphLoader>

          <GraphLoader label="Graphs" isLoading={reportDataIsLoading}>
            <Graphs />
          </GraphLoader>

          <GraphLoader label="Report pie chart" isLoading={reportDataIsLoading}>
            <ReportDoughnutChart />
          </GraphLoader>

          <GraphLoader label="Report tables" isLoading={reportDataIsLoading}>
            <ReportTables />
          </GraphLoader>
        </Show.Else>
      </Show>
    </Box>
  );
};

export default DiscoveryPreview;
