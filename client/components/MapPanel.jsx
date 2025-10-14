import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader } from "@googlemaps/js-api-loader";
import { Crosshair, PauseCircle, PlayCircle, RefreshCw } from "react-feather";
import Button from "./Button";

const DEFAULT_CENTER = { lat: 40.758, lng: -73.9855 }; // Times Square
const DEFAULT_ZOOM = 13;
const CAPTURE_INTERVAL_MS = 15000;
const STATIC_IMAGE_SIZE = { width: 640, height: 640 };

const STATUS_LABELS = {
  idle: "idle",
  loading: "loading map...",
  ready: "map ready",
  streaming: "streaming to assistant",
  paused: "map stream paused",
  error: "error",
};

function formatLatLng({ lat, lng }) {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function getStatusMessage(status, lastSnapshot) {
  if (status === "streaming" && lastSnapshot) {
    return `streaming (last snapshot ${lastSnapshot.relativeTime})`;
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

  const [status, setStatus] = useState("idle");
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [lastSnapshot, setLastSnapshot] = useState(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const apiKey = useMemo(() => import.meta.env.VITE_GOOGLE_MAPS_API_KEY, []);

  const stopStreaming = useCallback((options = {}) => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsStreaming(false);
    if (!options.preserveStatus) {
      setStatus((previous) => (previous === "streaming" ? "paused" : previous));
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
      setStatus("streaming");
      if (onSnapshot) {
        onSnapshot(snapshot);
      }
    } catch (error) {
      console.error("Failed to capture map snapshot", error);
      setErrorMessage(error.message);
      stopStreaming({ preserveStatus: true });
      setStatus("error");
    }
  }, [apiKey, onSnapshot, stopStreaming]);

  const startStreaming = useCallback(() => {
    if (!mapRef.current || !apiKey) return;
    if (intervalRef.current) return;

    setErrorMessage("");
    captureSnapshot();
    intervalRef.current = setInterval(() => {
      captureSnapshot();
    }, CAPTURE_INTERVAL_MS);
    setIsStreaming(true);
    setStatus("streaming");
  }, [apiKey, captureSnapshot]);

  useEffect(() => {
    if (!apiKey) return;
    if (!mapContainerRef.current) return;

    let isCancelled = false;

    async function loadMap() {
      try {
        setStatus("loading");
        const loader = new Loader({ apiKey, version: "weekly", libraries: [] });
        const googleMaps = await loader.load();
        if (isCancelled) return;
        mapRef.current = new googleMaps.Map(mapContainerRef.current, {
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
      stopStreaming();
    };
  }, [apiKey, stopStreaming]);

  useEffect(() => {
    if (!isSessionActive) {
      stopStreaming();
      return;
    }

    if (mapLoaded && apiKey) {
      startStreaming();
    }
  }, [apiKey, isSessionActive, mapLoaded, startStreaming, stopStreaming]);

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

  const handleManualSnapshot = useCallback(() => {
    if (!mapRef.current || !apiKey) return;
    captureSnapshot();
  }, [apiKey, captureSnapshot]);

  const toggleStreaming = useCallback(() => {
    if (!mapRef.current) return;
    if (isStreaming) {
      stopStreaming();
    } else {
      startStreaming();
    }
  }, [isStreaming, startStreaming, stopStreaming]);

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
            status === "streaming"
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
        can pause or trigger a fresh snapshot at any time.
      </p>
      <form className="flex gap-2" onSubmit={handleSearch}>
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
      </form>
      <div
        ref={mapContainerRef}
        className="flex-1 min-h-[260px] rounded-xl overflow-hidden border border-gray-200 shadow-inner bg-gray-100"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          className="bg-gray-700 px-4 py-2"
          onClick={handleUseCurrentLocation}
          icon={<Crosshair size={16} />}
          disabled={!mapLoaded}
        >
          current location
        </Button>
        <Button
          className="bg-gray-700 px-4 py-2"
          onClick={handleManualSnapshot}
          icon={<RefreshCw size={16} />}
          disabled={!mapLoaded}
        >
          snapshot now
        </Button>
        <Button
          className={`px-4 py-2 ${
            isStreaming ? "bg-yellow-600" : "bg-green-600"
          }`}
          onClick={toggleStreaming}
          icon={
            isStreaming ? <PauseCircle size={16} /> : <PlayCircle size={16} />
          }
          disabled={!mapLoaded}
        >
          {isStreaming ? "pause stream" : "resume stream"}
        </Button>
      </div>
      {lastSnapshot ? (
        <figure className="flex flex-col gap-1">
          <figcaption className="text-xs text-gray-500 uppercase tracking-widest">
            last snapshot · {formatLatLng(lastSnapshot.center)} · zoom {" "}
            {lastSnapshot.zoom}
          </figcaption>
          <img
            src={lastSnapshot.dataUrl}
            alt="Latest captured map view"
            className="w-full h-auto rounded-lg border border-gray-200"
          />
        </figure>
      ) : (
        <p className="text-sm text-gray-500">
          Snapshot preview will appear here once streaming begins.
        </p>
      )}
      {errorMessage ? (
        <p className="text-sm text-red-600">{errorMessage}</p>
      ) : null}
    </section>
  );
}
