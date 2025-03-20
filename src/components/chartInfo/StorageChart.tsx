import { FileServerOverviewApi } from "@/types/app.type";
import { Box } from "@components/container/index";
import { DoughnutChart } from "@netapp/bxp-design-system-react";
import LegendWrapper from "@components/chartInfo/LegendWrapper";
import { Tooltip } from "@netapp/bxp-design-system-react";
import React, { useMemo } from "react";
import {
  calculateTotal,
  formatTotal,
} from "@components/chartInfo/legends.utils";

const StorageChart = ({
  storageDetails: {
    totalDiscoveredSize,
    totalPendingSize,
    totalMigratedSize,
    totalFileServers,
  },
}: {
  storageDetails: FileServerOverviewApi["storageDetails"];
}) => {
  const [totalDiscoveredSizeInDigit, unit] = totalDiscoveredSize.split(" ");
  const [totalPendingSizeInDigit] = totalPendingSize.split(" ");
  const [totalMigratedSizeInDigit] = totalMigratedSize.split(" ");

  const totalSize = useMemo(() => {
    return calculateTotal([
      +totalMigratedSizeInDigit,
      +totalPendingSizeInDigit,
    ]);
  }, [totalMigratedSizeInDigit, totalPendingSizeInDigit]);

  const formattedTotal = (total: number) => formatTotal(total, unit);

  return (
    <>
      <Box>
        {totalSize.toString().length > 3 && (
          <Tooltip>{`${totalSize} ${unit}`}----</Tooltip>
        )}
        <DoughnutChart
          unit={unit && unit.toUpperCase()}
          label={
            <Box className="text-center">
              Discovered
              <br />
              Storage
            </Box>
          }
          colors={[["chart-4", "chart-7"], ["chart-6"]]}
          valueFormatter={formattedTotal}
          data={[
            [+totalMigratedSizeInDigit, +totalPendingSizeInDigit],
            [+totalDiscoveredSizeInDigit],
          ]}
        />
      </Box>
      <Box className="flex gap-4 w-full flex-wrap">
        <LegendWrapper
          title="Discoverd"
          value={totalDiscoveredSizeInDigit}
          color="bg-yellow-500"
          unit={unit}
        />
        <LegendWrapper
          title="Pending"
          value={totalPendingSizeInDigit}
          color="bg-orange-500"
          unit={unit}
        />
        <LegendWrapper
          title="Migrated"
          value={totalMigratedSizeInDigit}
          color="bg-teal-500"
          unit={unit}
        />
        {totalFileServers !== undefined && (
          <LegendWrapper
            title="File Servers"
            value={totalFileServers}
            color="bg-white"
            unit=""
          />
        )}
      </Box>
    </>
  );
};

export default StorageChart;
