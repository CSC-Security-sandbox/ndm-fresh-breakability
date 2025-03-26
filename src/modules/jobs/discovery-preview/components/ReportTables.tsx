import { Box } from "@components/container/index";
import { useGetReportDataQuery } from "@api/reportApi";
import ReportTableRenderer from "./ReportTableRenderer";
import { JOBS_TYPE, ReportDataPayloadType } from "@/types/app.type";
import {
  BIGGEST_FILE_SIZE_NAME_COLS,
  LONGEST_FILE_NAME_COLS,
  LONGEST_PATH_TABLE_COLUMS,
} from "@modules/jobs/discovery-preview/preview.constants";
import {
  extractBiggestFiles,
  extractLongestDirectoryPaths,
  longestFileNames,
} from "@modules/jobs/discovery-preview/preview.decorators";
import { useParams } from "react-router-dom";

const ReportTables = () => {
  const { jobRunId } = useParams<{ jobRunId: string }>();
  const payload: ReportDataPayloadType = {
    jobRunId: jobRunId,
    reportType: JOBS_TYPE.DISCOVERY,
  };
  const { data: reportData } = useGetReportDataQuery(payload);
  return (
    <>
      <Box className="flex gap-4 mt-4">
        <Box className="w-full">
          <ReportTableRenderer
            title="Longest Path"
            tooltipContent="Files with longest path."
            columns={LONGEST_PATH_TABLE_COLUMS}
            rows={extractLongestDirectoryPaths(reportData)}
            isSorting={true}
            defaultSortState={{ sortOrder: "desc", column: 2 }}
          />
        </Box>
        <Box className="w-full">
          <ReportTableRenderer
            title="Biggest Size"
            tooltipContent="Files with highest size."
            columns={BIGGEST_FILE_SIZE_NAME_COLS}
            rows={extractBiggestFiles(reportData)}
            isSorting={true}
            defaultSortState={{ sortOrder: "desc", column: 2 }}
          />
        </Box>
      </Box>
      <Box className="mt-4">
        <ReportTableRenderer
          title="Longest Names"
          tooltipContent="Files with longest name."
          columns={LONGEST_FILE_NAME_COLS}
          rows={longestFileNames(reportData)}
        />
      </Box>
    </>
  );
};

export default ReportTables;
