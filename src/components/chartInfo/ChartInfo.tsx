import { Box } from "@components/container/index";
import { ChartInfoPropsType } from "@/types/app.type";
import {
  Card,
  CardContent,
  CardContentLoading,
  CardHeader,
  CardTitle,
} from "@netapp/bxp-design-system-react";
import React from "react";
import ChartError from "./ChartError";

const ChartInfo = React.memo(
  ({ title, Icon, children, isLoading, isError }: ChartInfoPropsType) => {
    return (
      <Box className="w-full grow">
        <Card className="h-full">
          <CardHeader type="small">
            <CardTitle className="flex gap-3 items-center">
              <Icon size="30" />
              {title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Box className="flex gap-8">
              {!isLoading && !isError && children}
              {isLoading && <CardContentLoading className="h-40" />}
              {isError && <ChartError>Failed to load data!</ChartError>}
            </Box>
          </CardContent>
        </Card>
      </Box>
    );
  }
);

export default ChartInfo;
