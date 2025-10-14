import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { Crosshair, PauseCircle, PlayCircle, RefreshCw } from "react-feather";
import Button from "./Button";

const DEFAULT_CENTER = { lat: 40.758, lng: -73.9855 }; // Times Square
const DEFAULT_ZOOM = 13;
const CAPTURE_INTERVAL_MS = 15000;
const STATIC_IMAGE_SIZE = { width: 480, height: 640 };

const STATUS_LABELS = {
  idle: "idle",
  loading: "loading map...",
  ready: "map ready",
  capturing: "capturing snapshots",
  paused: "snapshot timer paused",
  error: "error",
};

function formatLatLng({ lat, lng }) {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function getStatusMessage(status, lastSnapshot) {
  if (status === "capturing" && lastSnapshot) {
    return `capturing snapshots (last snapshot ${lastSnapshot.relativeTime})`;
  }

  if (status === "paused" && lastSnapshot) {
    return `paused (last snapshot ${lastSnapshot.relativeTime})`;
  }

  return STATUS_LABELS[status] || status;
}

function computeRelativeTime(timestamp) {
  if (!timestamp) return "never";
  const delta = Date.now() - timestamp;
  if (delta < 1000) return "just now";
  if (delta < 60000) return `${Math.round(delta / 1000)}s ago`;
  const minutes = Math.round(delta / 60000);
  return `${minutes}m ago`;
}

export default function MapPanel({ isSessionActive, onSnapshot }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const intervalRef = useRef(null);
  const viewRef = useRef({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
  const loaderInitializedRef = useRef(false);

  const [status, setStatus] = useState("idle");
  const [isSnapshotTimerActive, setIsSnapshotTimerActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [lastSnapshot, setLastSnapshot] = useState(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const apiKey = useMemo(() => import.meta.env.VITE_GOOGLE_MAPS_API_KEY, []);

  const stopSnapshotTimer = useCallback((options = {}) => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsSnapshotTimerActive(false);
    if (!options.preserveStatus) {
      setStatus((previous) =>
        previous === "capturing" ? "paused" : previous,
      );
    }
  }, []);

  const captureSnapshot = useCallback(async () => {
    if (!apiKey || !mapRef.current) return;

    try {
      const { center, zoom } = viewRef.current;
      const timestamp = Date.now();
      const staticUrl = new URL(
        "https://maps.googleapis.com/maps/api/staticmap",
      );
      staticUrl.searchParams.set("center", `${center.lat},${center.lng}`);
      staticUrl.searchParams.set("zoom", `${zoom}`);
      staticUrl.searchParams.set(
        "size",
        `${STATIC_IMAGE_SIZE.width}x${STATIC_IMAGE_SIZE.height}`,
      );
      staticUrl.searchParams.set("scale", "2");
      staticUrl.searchParams.set("maptype", "roadmap");
      staticUrl.searchParams.set("key", apiKey);

      const response = await fetch(staticUrl.toString());
      if (!response.ok) {
        throw new Error(
          `Static map request failed with status ${response.status}`,
        );
      }

      const blob = await response.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const imageBase64 = dataUrl.split(",")[1];
      const snapshot = {
        dataUrl,
        imageBase64,
        mediaType: blob.type || "image/png",
        center,
        zoom,
        capturedAt: timestamp,
        relativeTime: computeRelativeTime(timestamp),
      };
      setLastSnapshot(snapshot);
      setErrorMessage("");
      setStatus("capturing");
      if (onSnapshot) {
        onSnapshot(snapshot);
      }
    } catch (error) {
      console.error("Failed to capture map snapshot", error);
      setErrorMessage(error.message);
      stopSnapshotTimer({ preserveStatus: true });
      setStatus("error");
    }
  }, [apiKey, onSnapshot, stopSnapshotTimer]);

  const startSnapshotTimer = useCallback(() => {
    if (!mapRef.current || !apiKey) return;
    if (intervalRef.current) return;

    setErrorMessage("");
    captureSnapshot();
    intervalRef.current = setInterval(() => {
      captureSnapshot();
    }, CAPTURE_INTERVAL_MS);
    setIsSnapshotTimerActive(true);
    setStatus("capturing");
  }, [apiKey, captureSnapshot]);

  useEffect(() => {
    if (!apiKey) return;
    if (!mapContainerRef.current) return;

    let isCancelled = false;

    async function loadMap() {
      try {
        setStatus("loading");
        if (!loaderInitializedRef.current) {
          setOptions({ key: apiKey, v: "weekly" });
          loaderInitializedRef.current = true;
        }

        const { Map: GoogleMap } = await importLibrary("maps");
        if (isCancelled) return;
        mapRef.current = new GoogleMap(mapContainerRef.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          disableDefaultUI: true,
          zoomControl: true,
          streetViewControl: false,
          mapTypeControl: false,
        });

        mapRef.current.addListener("idle", () => {
          const center = mapRef.current.getCenter();
          const zoom = mapRef.current.getZoom();
          const currentView = {
            center: { lat: center.lat(), lng: center.lng() },
            zoom,
          };
          viewRef.current = currentView;
          setLastSnapshot((snapshot) =>
            snapshot
              ? {
                  ...snapshot,
                  center: currentView.center,
                  zoom: currentView.zoom,
                  relativeTime: computeRelativeTime(snapshot.capturedAt),
                }
              : snapshot,
          );
        });

        setMapLoaded(true);
        setStatus("ready");
      } catch (error) {
        console.error("Failed to load Google Maps", error);
        setErrorMessage(error.message);
        setStatus("error");
      }
    }

    loadMap();

    return () => {
      isCancelled = true;
      stopSnapshotTimer();
    };
  }, [apiKey, stopSnapshotTimer]);

  useEffect(() => {
    if (!isSessionActive) {
      stopSnapshotTimer();
      return;
    }

    if (mapLoaded && apiKey) {
      startSnapshotTimer();
    }
  }, [
    apiKey,
    isSessionActive,
    mapLoaded,
    startSnapshotTimer,
    stopSnapshotTimer,
  ]);

  useEffect(() => {
    if (!lastSnapshot) return;
    const interval = setInterval(() => {
      setLastSnapshot((snapshot) =>
        snapshot
          ? {
              ...snapshot,
              relativeTime: computeRelativeTime(snapshot.capturedAt),
            }
          : snapshot,
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [lastSnapshot]);

  const handleUseCurrentLocation = useCallback(() => {
    if (!mapRef.current) return;
    if (!navigator.geolocation) {
      setErrorMessage("Geolocation is not supported in this browser");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        mapRef.current.setCenter({ lat: latitude, lng: longitude });
        mapRef.current.setZoom(15);
        setErrorMessage("");
      },
      (error) => {
        setErrorMessage(error.message || "Failed to get current location");
      },
    );
  }, []);

  const handleSearch = useCallback(
    async (event) => {
      event.preventDefault();
      if (isSearching) return;
      if (!searchTerm.trim() || !apiKey) return;
      if (!mapRef.current) return;

      try {
        setIsSearching(true);
        setErrorMessage("");
        const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
        url.searchParams.set("address", searchTerm.trim());
        url.searchParams.set("key", apiKey);

        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error(`Geocode request failed with status ${response.status}`);
        }

        const data = await response.json();
        if (data.status !== "OK" || !data.results.length) {
          throw new Error("No results found for that search");
        }

        const { location } = data.results[0].geometry;
        mapRef.current.panTo(location);
        mapRef.current.setZoom(14);
        setSearchTerm(data.results[0].formatted_address);
      } catch (error) {
        console.error("Search failed", error);
        setErrorMessage(error.message);
      } finally {
        setIsSearching(false);
      }
    },
    [apiKey, isSearching, searchTerm],
  );

  const toggleSnapshotTimer = useCallback(() => {
    if (!mapRef.current) return;
    if (isSnapshotTimerActive) {
      stopSnapshotTimer();
    } else {
      startSnapshotTimer();
    }
  }, [isSnapshotTimerActive, startSnapshotTimer, stopSnapshotTimer]);

  if (!apiKey) {
    return (
      <section className="flex flex-col gap-3 h-full">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Map context stream</h2>
          <span className="text-xs uppercase tracking-widest text-gray-500">
            disabled
          </span>
        </header>
        <p className="text-gray-600 text-sm">
          Add a <code>VITE_GOOGLE_MAPS_API_KEY</code> environment variable and
          restart the dev server to enable live map context streaming.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 h-full">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Map context stream</h2>
        <span
          className={`text-xs uppercase tracking-widest ${
            status === "capturing"
              ? "text-green-600"
              : status === "error"
                ? "text-red-600"
                : "text-gray-500"
          }`}
        >
          {getStatusMessage(status, lastSnapshot)}
        </span>
      </header>
      <p className="text-xs text-gray-500 leading-snug">
        While a realtime session is connected, the current map view is captured
        every 15 seconds and shared with the assistant as visual context. You
        can pause the snapshot timer at any time.
      </p>
      <form className="flex flex-wrap gap-2" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="Search for a city or place"
          className="border border-gray-200 rounded-full px-4 py-2 flex-1 bg-white"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          disabled={!mapLoaded || isSearching}
        />
        <Button
          type="submit"
          className="bg-blue-500 px-4 py-2"
          disabled={!mapLoaded || isSearching}
          icon={<RefreshCw size={14} />}
        >
          {isSearching ? "searching..." : "search"}
        </Button>
        <Button
          type="button"
          className="bg-gray-700 px-4 py-2"
          onClick={handleUseCurrentLocation}
          icon={<Crosshair size={16} />}
          disabled={!mapLoaded}
        >
          current location
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        <Button
          className={`px-4 py-2 ${
            isSnapshotTimerActive ? "bg-yellow-600" : "bg-green-600"
          }`}
          onClick={toggleSnapshotTimer}
          icon={
            isSnapshotTimerActive ? (
              <PauseCircle size={16} />
            ) : (
              <PlayCircle size={16} />
            )
          }
          disabled={!mapLoaded}
        >
          {isSnapshotTimerActive ? "pause snapshots" : "resume snapshots"}
        </Button>
      </div>
      <div
        ref={mapContainerRef}
        className="flex-1 min-h-[360px] rounded-xl overflow-hidden border border-gray-200 shadow-inner bg-gray-100"
      />
      {errorMessage ? (
        <p className="text-sm text-red-600">{errorMessage}</p>
      ) : null}
    </section>
  );
}
