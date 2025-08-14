import Box from "@/components/container/Box";
import { Card } from "@netapp/bxp-design-system-react";
import { ABOUT_NDM_CONSTANTS } from "@modules/Help/components/about-ndm/constants/about-ndm.constants";
import { useEffect, useState } from "react";
import { AboutNDMApiRespType } from "@/types/app.type";
import { Show } from "@/components/show/Show";
import { useLazyAboutNdmQuery } from "@api/userApi";

const AboutNDMContent = () => {
  const [getAboutNDM, { isError, isLoading }] = useLazyAboutNdmQuery();
  const [aboutNdm, setAboutNdm] = useState<AboutNDMApiRespType | null>(
    {} as AboutNDMApiRespType
  );

  useEffect(() => {
    (async () => {
      try {
        const result: AboutNDMApiRespType = await getAboutNDM("").unwrap();

        setAboutNdm(result);
      } catch (error) {
        console.error(error);
      }
    })();
  }, []);

  return (
    <Card>
      <Box className="flex flex-col gap-6 p-10 items-center">
        <Show>
          <Show.When isTrue={!!aboutNdm && !isError}>
            <Box className="flex flex-row items-center">
              <Box className="Box-lg font-semibold mr-2">Product:</Box>
              {aboutNdm?.product?.name} {aboutNdm?.product?.version}
            </Box>
            <Box className="flex flex-row items-center">
              <Box className="Box-lg font-semibold mr-2">
                {ABOUT_NDM_CONSTANTS.BUILDER_VERSION}
              </Box>
              Worker: {aboutNdm?.build?.worker_version?.version} | Control
              Plane: {aboutNdm?.build?.controlPlane_version?.version}
            </Box>
            <Box className="flex flex-row items-center">
              <Box className="Box-lg font-semibold mr-2">
                {ABOUT_NDM_CONSTANTS.CONTACT_US}
              </Box>
              <u className="text-blue-500">{aboutNdm?.contact?.email}</u>
            </Box>
            <Show>
              <Show.When isTrue={!!aboutNdm?.contact?.phone}>
                <Box className="flex flex-row items-center">
                  <Box className="Box-lg font-semibold mr-2">Phone:</Box>
                  {aboutNdm?.contact?.phone}
                </Box>
              </Show.When>
            </Show>
            <Show>
              <Show.When isTrue={!!aboutNdm?.contact?.website}>
                <Box className="flex flex-row items-center">
                  <Box className="Box-lg font-semibold mr-2">Website:</Box>
                  <u className="text-blue-500">{aboutNdm?.contact?.website}</u>
                </Box>
              </Show.When>
            </Show>
          </Show.When>
        </Show>

        <Show>
          <Show.When isTrue={isLoading}>
            <Box className="text-sm text-gray-500">
              Loading product information...
            </Box>
          </Show.When>
        </Show>

        <Show>
          <Show.When isTrue={isError}>
            <Box className="text-sm text-red-500">
              Unable to fetch product information
            </Box>
          </Show.When>
        </Show>
      </Box>
    </Card>
  );
};

export default AboutNDMContent;
