import WizardProvider from "@modules/storage-servers/file-server//components/WizardProvider";
import CommonFileServerContextProvider from "@modules/storage-servers/file-server//context/CommonFileServerContextProvider";
import { withEditFileServer } from "@modules/storage-servers/file-server//context/withEditFileServer";

const EditFileServerContextWrapper = withEditFileServer(
  CommonFileServerContextProvider
);

const EditFileServer = () => {
  return (
    <EditFileServerContextWrapper>
      <WizardProvider />
    </EditFileServerContextWrapper>
  );
};

export default EditFileServer;
