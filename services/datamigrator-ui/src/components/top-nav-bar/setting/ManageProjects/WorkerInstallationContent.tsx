import React from "react";
import {
  Layout,
  Card,
  Text,
  CardContent,
  NumberedList,
  CodeSnippet,
  InlineLoader,
} from "@netapp/bxp-design-system-react";
import { WORKER_SCRIPT_PATH } from "@/constant/app.constants";
import Box from "@/components/container/Box";

const WorkerInstallationContent = ({
  workerSecret,
  projectId,
  controlPlaneIp,
  workerId,
  isLoading,
  isError,
}: {
  controlPlaneIp?: string;
  projectId?: string;
  workerId?: string;
  workerSecret?: string;
  isLoading?: boolean;
  isError?: boolean;
}) => (
  <Layout.Content>
    <Layout.Grid rowGap="md" style={{ margin: "10px" }}>
      <Layout.GridItem lg={12}>
        <Layout.Content>
          <Layout.Container className="!p-[3.5rem]">
            <Layout.Grid>
              <Layout.GridItem lg={12}>
                <NumberedList includeTitles={true}>
                  <>
                    <Text bold>Download and setup Worker Image/Binary</Text>
                    <Text>
                      Download and setup the worker VM (Linux image for NFS or Windows executable binary for SMB) by following
                      the NDM installation documentation section for your environment (GCP, Azure, or On-prem deployment).
                    </Text>
                  </>
                  <>
                    <Text bold>Register Worker VM</Text>
                    <Text>
                      For Linux worker, run the provided registration commands directly as instructed in the documentation.
                      For Windows worker, extract the WORKER_ID, WORKER_SECRET, and PROJECT_ID values from the provided commands and enter them when prompted during installation.
                    </Text>
                  </>
                </NumberedList>
              </Layout.GridItem>
            </Layout.Grid>
          </Layout.Container>
        </Layout.Content>
      </Layout.GridItem>
      <Layout.GridItem lg={12}>
        <Card>
          <CardContent>
            {isLoading ? (
              <InlineLoader />
            ) : isError ? (
              <Box>Failed to generate worker secrets</Box>
            ) : (
              <CodeSnippet
                highLightLanguage={"bash"}
                text={`export WORKER_ID=${workerId}
export WORKER_SECRET=${workerSecret}
export PROJECT_ID=${projectId}
export CONTROL_PLANE_IP=${controlPlaneIp}
sh ${WORKER_SCRIPT_PATH}`}
              />
            )}
          </CardContent>
        </Card>
      </Layout.GridItem>
    </Layout.Grid>
  </Layout.Content>
);

export default WorkerInstallationContent;
