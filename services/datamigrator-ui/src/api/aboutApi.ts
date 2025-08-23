import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders } from "@api/api.utils";
import { AboutNDMApiRespType } from "@/types/app.type";

export const aboutApi = createApi({
  reducerPath: "aboutApi",
  tagTypes: ["ABOUT_NDM"],
  baseQuery: fetchBaseQuery({
    baseUrl:
      window?.env?.VITE_ADMIN_SERVICE_URL ||
      import.meta.env.VITE_ADMIN_SERVICE_URL,
    prepareHeaders,
  }),
  endpoints: (builder) => ({
    getAboutNDM: builder.query<AboutNDMApiRespType, void>({
      queryFn: async () => {
        // Hardcoded response - as this api needs to build from BE side
        const hardcodedResponse: AboutNDMApiRespType = {
          data: {
            items: {
              product: {
                name: "NDM",
                version: "Preview",
              },
              build: {
                worker_version: {
                  version: "0.1.0",
                  time: null,
                },
                controlPlane_version: {
                  version: "0.1.0",
                  time: null,
                },
              },
              contact: {
                email: "niharika@netapp.com",
                phone: null,
                website: null,
              },
            },
          },
          message: "Success",
          statusCode: 200,
        };

        return { data: hardcodedResponse };
      },
      providesTags: ["ABOUT_NDM"],
    }),
  }),
});

export const { useGetAboutNDMQuery, useLazyGetAboutNDMQuery } = aboutApi;
