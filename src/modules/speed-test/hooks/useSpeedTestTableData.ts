import { useState, useCallback, useEffect } from "react";
import { useTable } from "@netapp/bxp-design-system-react";
import {
  RowStateType,
  SpeedDetailsType,
  SpeedOfWorkersPropsType,
  SpeedTestTableType,
  UseSpeedTestTableDataPropsType,
} from "@modules/speed-test/types/speed-test-details.types";
import { useGetSpeedTestDetailsQuery } from "@api/jobsApi";
import { useParams } from "react-router-dom";
import { SPEED_TEST_GRAPH_COLUMN_DEF } from "@modules/speed-test/constants/speed-test.constants";

export const useSpeedTestTableData = (): UseSpeedTestTableDataPropsType => {
  const [rowSelections, setRowSelections] = useState<{ [key: string]: number }>(
    {}
  );
  const [timeStamp, setTimestamp] = useState<string[]>([]);
  const [graphData, SetGraphData] = useState<number[][]>([]);
  const [workerLegends, SetWorkerLegends] = useState<SpeedOfWorkersPropsType[]>(
    []
  );
  const [speedDetails, setSpeedDetails] = useState<SpeedDetailsType>(
    {} as SpeedDetailsType
  );
  const { jobRunId } = useParams<{ jobRunId: string }>();
  const { data } = useGetSpeedTestDetailsQuery(jobRunId);

  //Details Tile data creation
  useEffect(() => {
    if (data) {
      const { fileServers, ...speedDetails } = data;
      setSpeedDetails({
        jobRunId: speedDetails.jobRunId,
        startTime: speedDetails.startTime,
        endTime: speedDetails.endTime,
        noOfFileServers: data?.fileServers.length,
        status: speedDetails.status,
        timeElapsed: "",
        totalWorkers: speedDetails.totalWorkers,
      });
    }
  }, [data]);

  const tableState = useTable({
    columns: SPEED_TEST_GRAPH_COLUMN_DEF,
    rows: data?.fileServers,
    isSorting: true,
    pageSize: 10,
  });

  const onRowClick = useCallback(
    (row: SpeedTestTableType) => {
      tableState.updateRowState(row.id)((rowState: RowStateType) => ({
        isExpanded: !(rowState && rowState.isExpanded),
      }));
    },
    [tableState.updateRowState]
  );

  const handleChange = (rowId: number, selected: { value: string }) => {
    setRowSelections((prevSelections) => ({
      ...prevSelections,
      [rowId]: selected.value,
    }));
  };

  return {
    tableState,
    rowSelections,
    handleChange,
    onRowClick,
    timeStamp,
    setTimestamp,
    graphData,
    SetGraphData,
    workerLegends,
    SetWorkerLegends,
    speedDetails,
  };
};
