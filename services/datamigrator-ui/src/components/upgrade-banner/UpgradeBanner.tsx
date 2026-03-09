import { useSelector, useDispatch } from "react-redux";
import { RootStateType } from "@store/store";
import { resetUploadState, BackgroundUploadState } from "@store/reducer/uploadSlice";
import { cancelBackgroundUpload } from "@/services/backgroundUploadManager";

const formatSize = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
};

const UpgradeBanner = () => {
  const dispatch = useDispatch();
  const upload = useSelector(
    (state: RootStateType) => (state as any).uploadSlice as BackgroundUploadState
  );

  if (!upload || upload.status === "idle" || upload.status === "cancelled") {
    return null;
  }

  const isActive = upload.status === "uploading" || upload.status === "finalizing";
  const isSuccess = upload.status === "uploaded";
  const isError = upload.status === "error" || upload.status === "validation_failed";

  const bgColor = isActive
    ? "bg-blue-600"
    : isSuccess
    ? "bg-green-600"
    : "bg-red-600";

  const handleDismiss = () => {
    dispatch(resetUploadState());
  };

  const handleCancel = () => {
    cancelBackgroundUpload();
  };

  return (
    <div
      className={`${bgColor} text-white px-4 py-2 flex items-center justify-between text-sm fixed top-0 left-0 right-0 z-[1300]`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {isActive && (
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent flex-shrink-0" />
        )}
        {isSuccess && (
          <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {isError && (
          <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" />
          </svg>
        )}

        <span className="truncate">
          {upload.status === "uploading" && (
            <>
              Uploading <strong>{upload.fileName}</strong> — {upload.progress}%
              {upload.totalBytes > 0 && (
                <span className="ml-1 opacity-80">
                  ({formatSize(upload.uploadedBytes)} / {formatSize(upload.totalBytes)})
                </span>
              )}
            </>
          )}
          {upload.status === "finalizing" && (
            <>
              Processing <strong>{upload.fileName}</strong> — validating checksums and extracting...
            </>
          )}
          {isSuccess && (
            <>
              <strong>{upload.fileName}</strong> uploaded successfully. Ready for upgrade.
            </>
          )}
          {isError && (
            <>
              Upload failed{upload.fileName ? ` for ${upload.fileName}` : ""}: {upload.error}
            </>
          )}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0 ml-4">
        {isActive && (
          <>
            {upload.status === "uploading" && (
              <div className="w-24 bg-white/30 rounded-full h-1.5">
                <div
                  className="bg-white rounded-full h-1.5 transition-all duration-300"
                  style={{ width: `${upload.progress}%` }}
                />
              </div>
            )}
            <button
              onClick={handleCancel}
              className="text-white/80 hover:text-white text-xs underline"
            >
              Cancel
            </button>
          </>
        )}
        {(isSuccess || isError) && (
          <button
            onClick={handleDismiss}
            className="text-white/80 hover:text-white"
            aria-label="Dismiss"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default UpgradeBanner;
