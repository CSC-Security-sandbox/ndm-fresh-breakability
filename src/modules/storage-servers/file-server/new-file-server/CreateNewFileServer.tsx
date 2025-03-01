import WizardProvider from "../components/WizardProvider";
import CommonFileServerContextProvider from "@modules/storage-servers/file-server//context/CommonFileServerContextProvider";
import { withCreateFileServer } from "@modules/storage-servers/file-server//context/withCreateFileServer";
import { Box } from "@components/container/index";

const CreateFileServerContextWrapper = withCreateFileServer(
  CommonFileServerContextProvider
);

const CreateNewFileServer = () => {
  return (
    <Box>
      <CreateFileServerContextWrapper>
        <WizardProvider />
      </CreateFileServerContextWrapper>
    </Box>
  );
};

export default CreateNewFileServer;
