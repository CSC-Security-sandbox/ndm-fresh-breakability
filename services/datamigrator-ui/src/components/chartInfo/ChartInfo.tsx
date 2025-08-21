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
import ChartError from "@components/chartInfo/ChartError";
import { Show } from "@components/show/Show";

const ChartInfo = React.memo(
  ({ title, Icon, children, isLoading, isError,lastRefreshed}: ChartInfoPropsType) => {
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
              <Show>
                <Show.When isTrue={isLoading}>
                  <CardContentLoading className="h-40" />
                </Show.When>
                <Show.When isTrue={isError}>
                  <ChartError>Failed to load data!</ChartError>
                </Show.When>
                <Show.Else>{children}</Show.Else>
              </Show>
            </Box>
          </CardContent>
        </Card>
      </Box>
    );
  }
);

export default ChartInfo;
