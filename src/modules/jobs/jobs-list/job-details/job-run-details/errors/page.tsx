"use client";
import { Box } from "@components/container/index";
import {
  Card,
  Text,
  Breadcrumbs,
  InnerTab,
  Tooltip,
} from "@netapp/bxp-design-system-react";
import { useCallback, useEffect, useState } from "react";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import {
  DUMMY_DATA,
  ERRORS_DUMMY_DATA,
  ERRORS_LIST_COLUMN_DEFS,
} from "../../job-details.constants";

const JobDescriptionInnerCard = ({
  name,
  value,
}: {
  name: string;
  value: string;
}) => (
  <Box className="flex flex-col gap-2">
    <Text>{name}</Text>
    <Text bold>{value}</Text>
  </Box>
);

export default function Page({
  params,
}: {
  params: Promise<{ jobRunId: string }>;
}) {
  const [jobRunId, setJobRunId] = useState<string>("");
  const [currentTab, setCurrentTab] = useState(2);

  const tableStateProps = {
    columns: ERRORS_LIST_COLUMN_DEFS,
    rows: ERRORS_DUMMY_DATA,
    isSorting: true,
  };

  const getJobDetails = useCallback(async () => {
    setJobRunId((await params).jobRunId);
  }, [params]);

  useEffect(() => {
    getJobDetails();
  }, [getJobDetails]);

  return (
    <Box className="p-8 flex flex-col gap-8">
      <Breadcrumbs>
        <a href="#">Jobs</a>
        <a href="#">Details</a>
        <a href="#">Run - {jobRunId}</a>
        <div>Errors</div>
      </Breadcrumbs>
      <Card className="py-4 px-12 flex justify-between">
        <JobDescriptionInnerCard
          name="Source File Server"
          value={DUMMY_DATA.source.server}
        />
        <JobDescriptionInnerCard
          name="Destination File Server"
          value={DUMMY_DATA.source.server}
        />
        <JobDescriptionInnerCard
          name="Source File Path"
          value={DUMMY_DATA.source.path}
        />
        <JobDescriptionInnerCard
          name="Destination File Path"
          value={DUMMY_DATA.source.path}
        />
      </Card>
      <InnerTab>
        <InnerTab.Button
          isActive={currentTab === 1}
          onClick={() => {
            setCurrentTab(1);
          }}
          isDisabled={true}
        >
          Fatal Errors
          <Tooltip>There are no errors in this category</Tooltip>
        </InnerTab.Button>
        <InnerTab.Button
          isActive={currentTab === 2}
          onClick={() => {
            setCurrentTab(2);
          }}
        >
          Transient Errors
        </InnerTab.Button>
      </InnerTab>
      <Box>
        <TableWrapper
          tableStateProps={tableStateProps}
          isLoading={false}
          label="Errors"
          content={<></>}
          isTogglingColumns={true}
          originalColumns={ERRORS_LIST_COLUMN_DEFS}
        />
      </Box>
    </Box>
  );
}
