import { Card, CardContent } from "@mui/material";
import {
  CardTitle,
  CardHeader,
  Popover,
} from "@netapp/bxp-design-system-react";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import useRTKApiRefresh from "@hooks/useRTKApiRefresh";
import { reportApi } from "@api/reportApi";

interface ReportTableProps {
  title: string;
  columns: any;
  rows: any;
  isSorting?: boolean;
  pageSize?: number;
  defaultSortState?: { sortOrder: "asc" | "desc"; column: number };
  tooltipContent: string;
  isFetching: boolean;
}

const ReportTableRenderer: React.FC<ReportTableProps> = ({
  title,
  columns,
  rows,
  isSorting = false,
  pageSize = 5,
  defaultSortState,
  tooltipContent,
  isFetching,
}) => {
  const tableState = {
    columns,
    rows,
    isSorting,
    pageSize,
    defaultSortState,
  };

  const refreshReportsList = useRTKApiRefresh({api: reportApi, tag: 'REPORT_DATA'});

  return (
    <Card>
      <CardHeader type="small">
        <CardTitle className="font-bold">{title}</CardTitle>
        <Popover>{tooltipContent}</Popover>
      </CardHeader>
      <CardContent>
        <TableWrapper
          tableStateProps={tableState}
          isLoading={false}
          showLabel={false}
          originalColumns={columns}
          refreshFunc={refreshReportsList}
          isRefreshing={isFetching}
        />
      </CardContent>
    </Card>
  );
};

export default ReportTableRenderer;
