import { Card, CardContent } from "@mui/material";
import {
  CardTitle,
  CardHeader,
  Popover,
} from "@netapp/bxp-design-system-react";
import TableWrapper from "@components/table-wrapper/TableWrapper";

interface ReportTableProps {
  title: string;
  columns: any;
  rows: any;
  isSorting?: boolean;
  pageSize?: number;
  defaultSortState?: { sortOrder: "asc" | "desc"; column: number };
  tooltipContent: string;
  showPagination?: boolean;
}

const ReportTableRenderer: React.FC<ReportTableProps> = ({
  title,
  columns,
  rows,
  isSorting = false,
  pageSize = 5,
  defaultSortState,
  tooltipContent,
  showPagination = true,
}) => {
  const tableState = {
    columns,
    rows,
    isSorting,
    pageSize,
    defaultSortState,
  };

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
          showSearch={false}
          showRefresh={false}
          showPagination={showPagination}
        />
      </CardContent>
    </Card>
  );
};

export default ReportTableRenderer;
