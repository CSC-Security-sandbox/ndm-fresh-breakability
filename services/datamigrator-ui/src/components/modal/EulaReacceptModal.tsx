import { useEffect, useState } from "react";
import { useAcceptEulaMutation, useLazyGetEulaStatusQuery } from "@api/eulaApi";

const POLL_INTERVAL_MS = 60000;

const EulaReacceptModal = () => {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchStatus, { data }] = useLazyGetEulaStatusQuery();
  const [acceptEula, { isLoading }] = useAcceptEulaMutation();

  const refresh = async () => {
    try {
      const status = await fetchStatus(undefined).unwrap();
      setOpen(!!status?.mustAccept);
      if (!status?.mustAccept) {
        setChecked(false);
      }
    } catch {
      // Keep app usable if endpoint is temporarily unavailable.
      setOpen(false);
    }
  };

  useEffect(() => {
    refresh();
    const intervalId = window.setInterval(refresh, POLL_INTERVAL_MS);
    const onOnline = () => refresh();
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  const onAccept = async () => {
    try {
      await acceptEula().unwrap();
      setError(null);
      setChecked(false);
      setOpen(false);
      await refresh();
    } catch (e: any) {
      setError(e?.data?.message || "Failed to save EULA acceptance");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-300 bg-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            End User License Agreement Update
          </h2>
          <p className="text-sm text-gray-700 mt-1">
            Version: {data?.version || "latest"}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-6 text-sm text-gray-800 leading-6">
          <div
            dangerouslySetInnerHTML={{
              __html:
                data?.content ||
                "<p>A new EULA version is required after upgrade.</p>",
            }}
          />
        </div>
        <div className="px-6 py-4 border-t border-gray-300 bg-gray-50">
          <label className="flex items-start gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span>I accept the updated End User License Agreement.</span>
          </label>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-400"
              disabled={!checked || isLoading}
              onClick={onAccept}
            >
              {isLoading ? "Saving..." : "Accept and Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EulaReacceptModal;
