import React, { useState } from "react";
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
  gatewayCACertificate,
  isLoading,
  isError,
}: {
  controlPlaneIp?: string;
  projectId?: string;
  workerId?: string;
  workerSecret?: string;
  gatewayCACertificate?: string;
  isLoading?: boolean;
  isError?: boolean;
}) => {
  const [selectedProtocol, setSelectedProtocol] = useState<'NFS' | 'SMB'>('NFS');
 
  const renderProtocolContent = () => {
    if (selectedProtocol === 'NFS') {
      return (
        <Box>
          <NumberedList includeTitles={true}>
            <>
              <Text bold>Download and setup Worker Image/Binary</Text>
              <Text>
                Download and setup the worker VM (Linux image) for NFS by following
                the NDM installation documentation section for your environment (GCP, Azure, or On-prem deployment).
              </Text>
            </>
            <>
              <Text bold>Register Worker VM</Text>
              <Text>
                For Linux worker, run the provided registration commands directly as instructed in the documentation.
              </Text>
            </>
          </NumberedList>
          
          <Box className="mt-4">
            {renderCodeSnippets()}
          </Box>
        </Box>
      );
    } else {
      // SMB protocol instructions
      return (
        <Box>
          <NumberedList includeTitles={true}>
            <>
              <Text bold>Download and setup Worker Image/Binary</Text>
              <Text>
                Download and setup the worker VM (Windows executable binary) for SMB by following
                the NDM installation documentation section for your environment (GCP, Azure, or On-prem deployment).
              </Text>
            </>
            <>
              <Text bold>Register Worker VM</Text>
              <Text>
                For Windows worker, extract the WORKER_ID, WORKER_SECRET, PROJECT_ID, and TLS_CERT values from the provided commands and enter them when prompted during installation.
              </Text>
            </>
          </NumberedList>
          
          <Box className="mt-4">
            {renderCodeSnippets()}
          </Box>
        </Box>
      );
    }
  };
 
  const renderCodeSnippets = () => {
    if (isLoading) {
      return <InlineLoader />;
    }
    
    if (isError) {
      return <Box>Failed to generate worker secrets</Box>;
    }
 
    if (selectedProtocol === 'NFS') {
      // NFS specific export commands
      return (
        <Card>
          <CardContent>
            <CodeSnippet
              highLightLanguage={"bash"}
              text={`export WORKER_ID=${workerId}
export WORKER_SECRET=${workerSecret}
export PROJECT_ID=${projectId}
export CONTROL_PLANE_IP=${controlPlaneIp}
export TLS_CERT=${gatewayCACertificate}
sh ${WORKER_SCRIPT_PATH}`}
            />
          </CardContent>
        </Card>
      );
    } else {
      // SMB specific values
      return (
        <Card>
          <CardContent>
            <Layout.Grid rowGap="sm">
              <Layout.GridItem lg={12}>
                <Text className="text-base font-semibold mb-2">WORKER_ID</Text>
                <CodeSnippet
                  highLightLanguage={"text"}
                  text={workerId || ""}
                />
              </Layout.GridItem>
              <Layout.GridItem lg={12}>
                <Text className="text-base font-semibold mb-2">WORKER_SECRET</Text>
                <CodeSnippet
                  highLightLanguage={"text"}
                  text={workerSecret || ""}
                />
              </Layout.GridItem>
              <Layout.GridItem lg={12}>
                <Text className="text-base font-semibold mb-2">PROJECT_ID</Text>
                <CodeSnippet
                  highLightLanguage={"text"}
                  text={projectId || ""}
                />
              </Layout.GridItem>
              <Layout.GridItem lg={12}>
                <Text className="text-base font-semibold mb-2">CONTROL_PLANE_IP</Text>
                <CodeSnippet
                  highLightLanguage={"text"}
                  text={controlPlaneIp || ""}
                />
              </Layout.GridItem>
              <Layout.GridItem lg={12}>
                <Text className="text-base font-semibold mb-2">TLS_CERT</Text>
                <CodeSnippet
                  highLightLanguage={"text"}
                  text={gatewayCACertificate || ""}
                />
              </Layout.GridItem>
            </Layout.Grid>
          </CardContent>
        </Card>
      );
    }
  };
 
  return (
    <Layout.Content>
      <Layout.Grid rowGap="md" style={{ margin: "10px" }}>
        <Layout.GridItem lg={12}>
          <Layout.Content>
            <Layout.Container className="!p-[3.5rem]">
              <Layout.Grid>
                <Layout.GridItem lg={12}>
                  {/* Protocol Toggle */}
                  <Box className="mb-6">
                    <Text className="text-base font-semibold mb-3">Worker Protocol</Text>
                    <Box className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="protocol"
                          value="NFS"
                          checked={selectedProtocol === 'NFS'}
                          onChange={(e) => setSelectedProtocol(e.target.value as 'NFS' | 'SMB')}
                          className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                        />
                        <Text className="text-sm font-medium">NFS</Text>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="protocol"
                          value="SMB"
                          checked={selectedProtocol === 'SMB'}
                          onChange={(e) => setSelectedProtocol(e.target.value as 'NFS' | 'SMB')}
                          className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                        />
                        <Text className="text-sm font-medium">SMB</Text>
                      </label>
                    </Box>
                  </Box>
 
                  {/* Protocol-specific content with integrated code snippets */}
                  {renderProtocolContent()}
                </Layout.GridItem>
              </Layout.Grid>
            </Layout.Container>
          </Layout.Content>
        </Layout.GridItem>
      </Layout.Grid>
    </Layout.Content>
  );
};
 
export default WorkerInstallationContent;

