import { Card, Table, TablePager } from "@netapp/bxp-design-system-react";
import { useSpeedTestTableData } from "@modules/speed-test/hooks/useSpeedTestTableData";
import { Box } from "@components/container";
import DetailsTile from "@modules/speed-test/components/speed-test-details/components/DetailsTile";
import { SubRowRendererPropsType } from "@modules/speed-test/types/speed-test.types";
import SubRowRenderer from "@modules/speed-test/components/speed-test-details/components/SubRowRenderer";

const SpeedTestDetails = () => {
  const { tableState, rowSelections, handleChange, onRowClick, speedDetails } =
    useSpeedTestTableData();

  return (
    <Box className="p-6">
      <Card>
        <Box className="flex flex-col px-8 py-3">
          <Box className="grid grid-cols-4 gap-3">
            {Object.entries(speedDetails).map(([key, value], index) => (
              <DetailsTile
                key={index}
                title={key}
                value={value}
                startTime={speedDetails?.startTime}
                endTime={speedDetails?.endTime}
              />
            ))}
          </Box>
        </Box>
      </Card>
      <Box className="w-full pt-4">
        <Table
          {...tableState}
          rows={tableState?.pagination?.pageRows}
          onRowClick={onRowClick}
          SubRowRenderer={(props: SubRowRendererPropsType) => (
            <SubRowRenderer
              {...props}
              rowSelections={rowSelections}
              handleChange={handleChange}
            />
          )}
        />
        {tableState?.pagination?.pageRows && (
          <TablePager
            pageRows={tableState?.pagination?.pageRows}
            pageSize={10}
            rows={tableState?.organizedRows}
            pageIndex={tableState?.pagination?.pageIndex}
            pageCount={tableState?.pagination?.pageCount}
            gotoPage={tableState?.pagination?.gotoPage}
          />
        )}
      </Box>
    </Box>
  );
};

export default SpeedTestDetails;
