import Box from "@/components/container/Box";
import { Card, InlineLoader } from "@netapp/bxp-design-system-react";
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
          <Show.When isTrue={isLoading}>
            <Box className="flex flex-col items-center">
              <InlineLoader />
              <span className="text-sm text-gray-500 mt-2">Loading product information...</span>
            </Box>
          </Show.When>
          <Show.When isTrue={!isLoading && !isError && !!aboutNdm}>
            <Box className="flex flex-row items-center">
              <Box className="Box-lg font-semibold mr-2">Product:</Box>
              {aboutNdm?.product?.name} {aboutNdm?.product?.version}
            </Box>
            <Box className="flex flex-row items-center">
              <Box className="Box-lg font-semibold mr-2">Control Plane:</Box>
              {aboutNdm?.build?.controlPlane_version?.version}
            </Box>
            <Box className="flex flex-row items-center">
              <Box className="Box-lg font-semibold mr-2">Serial ID:</Box>
              {aboutNdm?.product?.serialId || "N/A"}
            </Box>

            {/* Worker Versions — table format: version | worker list */}
            {aboutNdm?.build?.workersByVersion && Object.keys(aboutNdm.build.workersByVersion).length > 0 ? (
              <Box className="w-full">
                <Box className="Box-lg font-semibold mb-2">Worker Versions:</Box>
                <Box className="border rounded overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-center bg-header-netapp-bg">
                        <th className="px-4 py-2 font-semibold text-white border-b w-[140px]">Version</th>
                        <th className="px-4 py-2 font-semibold text-white border-b">Worker List</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(aboutNdm.build.workersByVersion).flatMap(([version, workers]) =>
                        (workers as any[]).map((w: any, idx: number) => (
                          <tr key={`${version}-${w.workerName}`} className="border-b last:border-b-0 text-center">
                            {idx === 0 ? (
                              <td className="px-4 py-1.5 font-medium text-gray-800 align-middle" rowSpan={(workers as any[]).length}>
                                {version}
                              </td>
                            ) : null}
                            <td className="px-4 py-1.5 text-gray-700">
                              {w.workerName} ({w.ipAddress})
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </Box>
              </Box>
            ) : (
              <Box className="flex flex-row items-center">
                <Box className="Box-lg font-semibold mr-2">Workers:</Box>
                <span className="text-gray-500">No workers attached</span>
              </Box>
            )}

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
