import { Box } from "@components/container/index";
import {
  BarChart,
  Card,
  CardContent,
  CardTitle,
  FormFieldSelect,
  useForm,
  CardHeader,
  Popover,
} from "@netapp/bxp-design-system-react";
import { useParams } from "react-router-dom";
import { useGetReportDataQuery } from "@api/reportApi";
import { JOBS_TYPE, ReportDataPayloadType } from "@/types/app.type";
import { OPTIONS_FOR_CHART_TOGGLE } from "@modules/jobs/discovery-preview/constants/preview.constants";
import {
  formatBytes,
  formatLargeNumber,
} from "@modules/jobs/discovery-preview/utils/chart-data.utils";
import { CHART_MAPER } from "@modules/jobs/discovery-preview/constants/table-mapper.constants";

const Graphs = () => {
  const { jobRunId } = useParams<{ jobRunId: string }>();
  const payload: ReportDataPayloadType = {
    jobRunId: jobRunId,
    reportType: JOBS_TYPE.DISCOVERY,
  };
  const { data: reportData } = useGetReportDataQuery(payload);

  const form = useForm({
    dataset: { label: "File Count", value: "fileCount" },
  });
  const isDataToShowInSize = form.formState.dataset?.value === "fileSize";

  return (
    <Box className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      {CHART_MAPER(reportData).map((chart, index) => (
        <Card key={index} className="flex flex-col">
          {chart.haveToggle ? (
            <div className="flex justify-between px-8 py-4 border-b-2 items-center">
              <Box className="flex gap-0.5 items-center">
                <CardTitle className="font-bold">{chart.label}</CardTitle>
                <Popover>{chart.label}</Popover>
              </Box>
              <div className="w-2xl">
                <FormFieldSelect
                  name="dataset"
                  form={form}
                  options={OPTIONS_FOR_CHART_TOGGLE}
                  style={{ marginBottom: 0 }}
                />
              </div>
            </div>
          ) : (
            <CardHeader>
              <CardTitle className="font-bold">{chart.label}</CardTitle>
              <Popover>{chart.label}</Popover>
            </CardHeader>
          )}
          <CardContent>
            <BarChart
              data={
                chart.haveToggle
                  ? isDataToShowInSize
                    ? chart.sizeData
                    : chart.countData
                  : chart.data
              }
              categories={
                chart.haveToggle
                  ? isDataToShowInSize
                    ? chart.sizeCategories
                    : chart.countCategories
                  : chart.categories
              }
              yTickFormatter={(x) =>
                chart.haveToggle && isDataToShowInSize
                  ? formatBytes(x)
                  : chart.haveToggle && !isDataToShowInSize
                  ? formatLargeNumber(x)
                  : x >= 100
                  ? formatLargeNumber(x)
                  : x
              }
            />
          </CardContent>
        </Card>
      ))}
    </Box>
  );
};

export default Graphs;
