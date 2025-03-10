import WizardProvider from "@modules/storage-servers/file-server/components/WizardProvider";
import CommonFileServerContextProvider from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { withCreateFileServer } from "@modules/storage-servers/file-server/context/withCreateFileServer";

const CreateFileServerContextWrapper = withCreateFileServer(
  CommonFileServerContextProvider
);

const CreateNewFileServer = () => {
  return (
    <CreateFileServerContextWrapper>
      <WizardProvider />
    </CreateFileServerContextWrapper>
  );
};

export default CreateNewFileServer;
