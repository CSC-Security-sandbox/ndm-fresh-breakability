import { useTable } from "@netapp/bxp-design-system-react";
import { memo, useContext } from "react";
import { SpeedTestConfigurationContext } from "@modules/speed-test/context/SpeedTestConfigurationContext";
import { SPEED_TEST_CONFIGURATION_FORM_COLUMN_DEF } from "@modules/speed-test/constants/speed-test.constants";
import TableWrapperWithoutFilter from "@components/table-wrapper/TableWrapperWithoutFilter";

const SpeedTestConfigurationTable = () => {
  const { speedTestConfiguration } = useContext(SpeedTestConfigurationContext);

  const tableState = useTable({
    columns: SPEED_TEST_CONFIGURATION_FORM_COLUMN_DEF,
    rows: speedTestConfiguration,
    isSorting: true,
    pageSize: 10,
  });

  return (
    <TableWrapperWithoutFilter
      tableState={tableState}
      isLoading={false}
      label=""
      showMenu={false}
    />
  );
};

export default memo(SpeedTestConfigurationTable);
