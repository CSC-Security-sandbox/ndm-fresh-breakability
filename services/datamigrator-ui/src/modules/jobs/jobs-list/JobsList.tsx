import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { hasPermission } from "@auth/auth.utils";
import { notify } from "@components/notification/NotificationWrapper";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import {
  useGetJobConfigsQuery,
  useUpdateJobStatusMutation,
  useDeleteJobConfigMutation,
  useLazyGetJobConfigDetailsQuery,
} from "@api/jobsApi";
import { JOB_CONFIG_STATUS_ENUM, JOB_STATUS_TYPE_ENUM } from "@/types/app.type";
import { useSearchParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import {
  COLUMNS_TO_FILTER_DEFS,
  defaultColumnState,
  JOB_LIST_COLUMN_DEFS,
  preSelectedFilterType,
} from "@modules/jobs/jobs-list/job-listing.constant";
import { getJobListFlaternList } from "@modules/jobs/jobs-list/listing.utils";
import { useDispatch } from "react-redux";
import { setModalProps, setModalClose } from "@store/reducer/commonComponentSlice";
import { Button } from "@netapp/bxp-design-system-react";

const JobsList = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();
  const canManageJob: boolean = hasPermission(
    USER_PERMISSION_TYPE_ENUM.ManageJob
  );
  const source = searchParams.get("source");
  const jobType = searchParams.get("type");
  const preSelectedFilter: preSelectedFilterType = {};
  if (source) preSelectedFilter.sourceServerName = source;
  if (jobType) preSelectedFilter.jobType = jobType;

  const { selectedProjectId } = useSelectedProjectId();
  const {
    data: jobList,
    isLoading,
    isError,
    isFetching,
    refetch: refetchJobList,
  } = useGetJobConfigsQuery({ projectId: selectedProjectId });
  const [updateStatus] = useUpdateJobStatusMutation();
  const [deleteJobConfig] = useDeleteJobConfigMutation();
  const [getJobConfigDetails] = useLazyGetJobConfigDetailsQuery();

  const handleDeleteJob = async (jobConfigId: string) => {
    try {
      await deleteJobConfig(jobConfigId).unwrap();
      notify.success("Job has been successfully deleted.");
      refetchJobList();
    } catch (error: any) {
      const errorMessage = error?.data?.message || "Failed to delete the job.";
      notify.error(errorMessage);
      console.error(error);
    }
  };

    const getActiveJobRuns = (jobRuns: any[]) => {
    const activeStatuses = [
      JOB_STATUS_TYPE_ENUM.RUNNING,
      JOB_STATUS_TYPE_ENUM.PENDING,
      JOB_STATUS_TYPE_ENUM.PAUSING,
      JOB_STATUS_TYPE_ENUM.READY,
      JOB_STATUS_TYPE_ENUM.STOPPING,
    ];
    
    return jobRuns.filter(jobRun => 
      activeStatuses.includes(jobRun.status)
    );
  };

  const openDeleteConfirmation = async (row: any) => {
    try {
      // Fetch current job config details including job runs
      const jobConfigResponse = await getJobConfigDetails({ 
        jobConfigId: row.jobConfigId 
      }).unwrap();
      
      const activeJobRuns = getActiveJobRuns(jobConfigResponse.jobRuns || []);
      const hasActiveRuns = activeJobRuns.length > 0;
      
      if (hasActiveRuns) {
        // Show warning modal for jobs with active runs
        dispatch(
          setModalProps({
            isOpen: true,
            modalHeader: "Can not delete the Job",
            modalContent: (
              <div className="flex flex-col gap-4 text-gray-700">
                <div className="bg-red-50 p-3 rounded-lg border-l-4 border-l-red-400">
                  <p className="text-red-800 font-medium">
                     This job cannot be deleted because it has {activeJobRuns.length} active job run{activeJobRuns.length > 1 ? 's' : ''}.
                  </p>
                </div>

                {/* Job Details Section */}
                <div className="bg-gray-50 p-4 rounded-lg border">
                  <h4 className="font-medium text-gray-800 mb-3">Job Configuration:</h4>
                  <div className="grid grid-cols-1 gap-2 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-600">Job ID:</span>
                      <span className="font-mono text-xs text-black">{row.jobConfigId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-600">Job Type:</span>
                      <span className="text-gray-800">{row.jobType || 'N/A'}</span>
                    </div>
                    {row.sourceServer?.path && (
                      <div className="flex justify-between">
                        <span className="font-medium text-gray-600">Source Path:</span>
                        <span className="font-mono text-xs text-gray-700 break-all">{row.sourceServer.path}</span>
                      </div>
                    )}
                    {row.destinationServer?.path && (
                      <div className="flex justify-between">
                        <span className="font-medium text-gray-600">Destination Path:</span>
                        <span className="font-mono text-xs text-gray-700 break-all">{row.destinationServer.path}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Active Job Runs Details */}
                <div className="bg-white border rounded-lg">
                  <div className="border-b p-3">
                    <h4 className="font-medium text-gray-800">
                      Active Job Runs ({activeJobRuns.length})
                    </h4>
                    <p className="text-xs text-gray-500 mt-1">
                      These job runs must be stopped or completed before deletion
                    </p>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {activeJobRuns.map((jobRun: any, index: number) => (
                      <div key={jobRun.jobRunId || index} className="p-3 border-b last:border-b-0 hover:bg-gray-50">
                        <div className="grid grid-cols-1 gap-2 text-sm">
                          <div className="flex justify-between items-center">
                            <span className="font-medium text-gray-600">Run ID:</span>
                            <span className="font-mono text-xs text-black">
                              {jobRun.jobRunId || 'Unknown ID'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="font-medium text-gray-600">Status:</span>
                            <span className={`px-2 py-1 rounded text-xs font-medium uppercase ${
                              jobRun.status === JOB_STATUS_TYPE_ENUM.RUNNING 
                                ? 'bg-green-100 text-green-800'
                                : jobRun.status === JOB_STATUS_TYPE_ENUM.PAUSING
                                ? 'bg-orange-100 text-orange-800'
                                : jobRun.status === JOB_STATUS_TYPE_ENUM.STOPPING
                                ? 'bg-red-100 text-red-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}>
                              {jobRun.status}
                            </span>
                          </div>
                          {jobRun.startTime && (
                            <div className="flex justify-between items-center">
                              <span className="font-medium text-gray-600">Started:</span>
                              <span className="text-gray-700 text-xs">
                                {new Date(jobRun.startTime).toLocaleString()}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 p-3 bg-blue-50 rounded-lg border-l-4 border-l-blue-400">
                  <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">Resolution Options:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Stop the active job runs manually</li>
                      <li>Wait for the job runs to complete naturally</li>
                      <li>Use the job management interface to pause/stop runs</li>
                    </ul>
                  </div>
                </div>
              </div>
            ),
            modalFooter: (
              <Button
                color="secondary"
                onClick={() => dispatch(setModalClose())}
              >
                Close
              </Button>
            ),
          })
        );
      } else {
        // Show delete confirmation modal for jobs without active runs
        dispatch(
          setModalProps({
            isOpen: true,
            modalHeader: "Delete Job Confirmation",
            modalContent: (
              <div className="flex flex-col gap-4 text-gray-700">
                <p className="text-lg font-medium">Are you sure you want to delete this job?</p>
                
                {/* Job Details Section */}
                <div className="bg-gray-50 p-4 rounded-lg border">
                  <h4 className="font-medium text-gray-800 mb-3">Job Configuration Details:</h4>
                  <div className="grid grid-cols-1 gap-2 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-600">Job ID:</span>
                      <span className="font-mono text-xs text-black">{row.jobConfigId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-600">Job Type:</span>
                      <span className="text-gray-800">{row.jobType || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-600">Status:</span>
                      <span className={`px-2 py-1 rounded text-xs uppercase font-medium ${
                        row.jobStatus === 'ACTIVE' 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {row.jobStatus}
                      </span>
                    </div>
                    {row.sourceServerName && (
                      <div className="flex justify-between">
                        <span className="font-medium text-gray-600">Source Server:</span>
                        <span className="text-gray-800">{row.sourceServerName}</span>
                      </div>
                    )}
                    {row.destinationServerName && (
                      <div className="flex justify-between">
                        <span className="font-medium text-gray-600">Destination Server:</span>
                        <span className="text-gray-800">{row.destinationServerName}</span>
                      </div>
                    )}
                    {row.sourceServer?.path && (
                      <div className="flex justify-between">
                        <span className="font-medium text-gray-600">Source Path:</span>
                        <span className="font-mono text-xs text-gray-700 break-all">{row.sourceServer.path}</span>
                      </div>
                    )}
                    {row.destinationServer?.path && (
                      <div className="flex justify-between">
                        <span className="font-medium text-gray-600">Destination Path:</span>
                        <span className="font-mono text-xs text-gray-700 break-all">{row.destinationServer.path}</span>
                      </div>
                    )}
                    {row.createdAt && (
                      <div className="flex justify-between">
                        <span className="font-medium text-gray-600">Created:</span>
                        <span className="text-gray-800">{new Date(row.createdAt).toLocaleString()}</span>
                      </div>
                    )}
                    {row.updatedAt && (
                      <div className="flex justify-between">
                        <span className="font-medium text-gray-600">Last Updated:</span>
                        <span className="text-gray-800">{new Date(row.updatedAt).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-red-50 p-3 rounded-lg border-l-4 border-l-red-400">
                  <p className="text-sm text-red-800 font-medium">
                     This action cannot be undone.
                  </p>
                  <p className="text-sm text-red-700 mt-1">
                    All associated job runs, logs, reports and configuration data will be permanently deleted.
                  </p>
                </div>
              </div>
            ),
            modalFooter: (
              <>
                <Button
                  color="secondary"
                  onClick={() => dispatch(setModalClose())}
                >
                  Cancel
                </Button>
                <Button
                  color="destructive"
                  onClick={() => {
                    handleDeleteJob(row.jobConfigId);
                    dispatch(setModalClose());
                  }}
                >
                  Delete
                </Button>
              </>
            ),
          })
        );
      }
    } catch (error: any) {
      const errorMessage = 'Failed to delete job. Please try again.';
      notify.error(errorMessage);
      console.error(error);
    }
  };

  const rowMenu = (row: any) => [
    {
      label: "Details",
      onClick: () => {
        navigate(`/job-details/${row.jobConfigId}`);
      },
    },
    {
      label:
        row.jobStatus === JOB_CONFIG_STATUS_ENUM.ACTIVE
          ? "Deactivate"
          : "Activate",
      onClick: () => {
        updateStatus({
          id: row.jobConfigId,
          status:
            row.jobStatus === JOB_CONFIG_STATUS_ENUM.ACTIVE
              ? JOB_CONFIG_STATUS_ENUM.INACTIVE
              : JOB_CONFIG_STATUS_ENUM.ACTIVE,
        })
          .then((res) => {
            if (res.error) throw res.error;
            notify.success("Successfully updated the job status.");
          })
          .catch((err) => {
            notify.error(err.message || "Failed to change the status.");
          });
      },
      disabled: !canManageJob,
    },
    {
      label: "Delete",
      onClick: () => openDeleteConfirmation(row),
      disabled: !canManageJob, // Make delete option red
    },
  ];

  const tableStateProps = {
    columns: JOB_LIST_COLUMN_DEFS,
    rows: jobList && getJobListFlaternList(jobList),
    isSorting: true,
    pageSize: 10,
    defaultColumnState,
    defaultSortState: { sortOrder: "desc", column: "updatedAt" },
  };

  if (isError) {
    notify.error("Failed to fetch job list.");
  }

  return (
    <TableWrapper
      tableStateProps={tableStateProps}
      isLoading={isLoading}
      rowMenu={rowMenu}
      label="Job Listings"
      content={<></>}
      isTogglingColumns={true}
      originalColumns={JOB_LIST_COLUMN_DEFS}
      showFilters={true}
      columnsToFilter={COLUMNS_TO_FILTER_DEFS}
      preSelectedFilter={preSelectedFilter}
      refetchTableData={refetchJobList}
      isRefreshing={isFetching}
    />
  );
};

export default JobsList;
