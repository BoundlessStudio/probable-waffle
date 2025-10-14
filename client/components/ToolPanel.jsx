export default function ToolPanel({ snapshots, isSessionActive }) {
  const hasSnapshots = snapshots && snapshots.length > 0;

  const statusMessage = hasSnapshots
    ? "Latest captured views"
    : isSessionActive
      ? "Snapshots will appear as the map streams."
      : "Start a session to begin capturing snapshots.";

  return (
    <section className="h-full w-full flex flex-col gap-4">
      <div className="h-full bg-gray-50 rounded-md p-4 flex flex-col">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Map snapshots</h2>
          {hasSnapshots ? (
            <span className="text-xs uppercase tracking-widest text-gray-500">
              {snapshots.length} saved
            </span>
          ) : null}
        </header>
        <p className="text-sm text-gray-500 mt-1">{statusMessage}</p>
        {hasSnapshots ? (
          <div className="mt-4 flex-1 overflow-y-auto pr-1">
            <ul className="grid grid-cols-2 gap-3">
              {snapshots.map((snapshot) => {
                const { capturedAt, dataUrl, relativeTime, center, zoom } =
                  snapshot;
                const locationLabel = `${center.lat.toFixed(
                  2,
                )}, ${center.lng.toFixed(2)}`;

                return (
                  <li key={capturedAt}>
                    <figure className="flex flex-col gap-1">
                      <img
                        src={dataUrl}
                        alt={`Map snapshot at ${locationLabel}`}
                        className="w-full h-32 object-cover rounded-md border border-gray-200 shadow-sm bg-white"
                      />
                      <figcaption className="text-xs text-gray-500 leading-tight">
                        {relativeTime} | zoom {zoom}
                        <br />
                        {locationLabel}
                      </figcaption>
                    </figure>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="mt-4 flex-1 border border-dashed border-gray-300 rounded-lg flex items-center justify-center text-sm text-gray-400">
            <span>No thumbnails yet.</span>
          </div>
        )}
      </div>
    </section>
  );
}
