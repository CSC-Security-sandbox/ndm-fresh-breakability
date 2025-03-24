import { Layout, TabHeader } from "@netapp/bxp-design-system-react";
import Box from "@components/container/Box";
import { AccessWrapperPropsType } from "@auth/access-wrapper/access-wrapper.types";

const AccessWrapper = ({ title, content }: AccessWrapperPropsType) => {
  return (
    <Layout.Page>
      <TabHeader label={title} />
      <Layout.Content className="p-10">
        <Box>{content}</Box>
      </Layout.Content>
    </Layout.Page>
  );
};

export default AccessWrapper;
