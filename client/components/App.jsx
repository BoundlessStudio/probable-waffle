import { useCallback, useEffect, useRef, useState } from "react";
import logo from "/assets/openai-logomark.svg";
import EventLog from "./EventLog";
import SessionControls from "./SessionControls";
import ToolPanel from "./ToolPanel";
import MapPanel from "./MapPanel";

const MAX_SNAPSHOTS = 12;

export default function App() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [events, setEvents] = useState([]);
  const [dataChannel, setDataChannel] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const peerConnection = useRef(null);
  const audioElement = useRef(null);

  async function startSession() {
    try {
      const tokenResponse = await fetch("/token");
      if (!tokenResponse.ok) {
        throw new Error(
          `Token request failed with status ${tokenResponse.status}`,
        );
      }

      const tokenData = await tokenResponse.json();
      const EPHEMERAL_KEY =
        tokenData?.client_secret?.value ??
        tokenData?.client_secret ??
        tokenData?.value;
      if (!EPHEMERAL_KEY) {
        console.error("Unexpected /token payload", tokenData);
        throw new Error("Missing ephemeral key in /token response");
      }

      const pc = new RTCPeerConnection();

      audioElement.current = document.createElement("audio");
      audioElement.current.autoplay = true;
      pc.ontrack = (event) => {
        audioElement.current.srcObject = event.streams[0];
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      mediaStream.getTracks().forEach((track) => pc.addTrack(track, mediaStream));

      const dataChannelInstance = pc.createDataChannel("oai-events");
      setDataChannel(dataChannelInstance);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const baseUrl = "https://api.openai.com/v1/realtime/calls";
      const model = "gpt-realtime";
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp",
          "OpenAI-Beta": "realtime=v1",
        },
      });

      if (!sdpResponse.ok) {
        const errorBody = await sdpResponse.text();
        console.error("Realtime handshake failed:", errorBody || sdpResponse.status);
        throw new Error(
          `Realtime API responded with status ${sdpResponse.status}`,
        );
      }

      const sdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp });

      peerConnection.current = pc;
    } catch (error) {
      console.error("Failed to start realtime session", error);
      stopSession();
    }
  }

  function stopSession() {
    if (dataChannel) {
      dataChannel.close();
    }

    const connection = peerConnection.current;
    if (connection) {
      connection.getSenders().forEach((sender) => {
        if (sender.track) {
          sender.track.stop();
        }
      });
      connection.close();
    }

    setIsSessionActive(false);
    setDataChannel(null);
    peerConnection.current = null;
  }

  const sendClientEvent = useCallback(
    (message) => {
      if (!dataChannel) {
        console.error(
          "Failed to send message - no data channel available",
          message,
        );
        return;
      }

      if (dataChannel.readyState !== "open") {
        console.warn(
          `Dropped client event because data channel is ${dataChannel.readyState}`,
          message,
        );
        return;
      }

      const timestamp = new Date().toLocaleTimeString();
      message.event_id = message.event_id || crypto.randomUUID();

      // Send event before setting timestamp since the backend peer doesn't expect this field
      dataChannel.send(JSON.stringify(message));

      if (!message.timestamp) {
        message.timestamp = timestamp;
      }
      setEvents((previous) => [message, ...previous]);
    },
    [dataChannel],
  );

  function sendTextMessage(message) {
    const event = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: message,
          },
        ],
      },
    };

    sendClientEvent(event);
    sendClientEvent({ type: "response.create" });
  }

  const handleMapSnapshot = useCallback(
    (snapshot) => {
      setSnapshots((previous) => {
        const next = [snapshot, ...previous];
        return next.slice(0, MAX_SNAPSHOTS);
      });

      if (!isSessionActive) {
        return;
      }

      if (!dataChannel || dataChannel.readyState !== "open") {
        return;
      }

      const { center, zoom, capturedAt, imageBase64, mediaType } = snapshot;
      const timestamp = new Date(capturedAt);
      const formattedTime = timestamp.toLocaleTimeString();
      const summary = `Latest map snapshot captured at ${formattedTime} (center ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)} | zoom ${zoom}).`;

      const event = {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          metadata: {
            source: "map_snapshot",
            captured_at: timestamp.toISOString(),
            center,
            zoom,
          },
          content: [
            {
              type: "input_text",
              text: summary,
            },
            {
              type: "input_image",
              image_base64: imageBase64,
              media_type: mediaType,
            },
          ],
        },
      };

      sendClientEvent(event);
    },
    [dataChannel, isSessionActive, sendClientEvent],
  );

  useEffect(() => {
    if (!dataChannel) {
      return undefined;
    }

    const handleMessage = (event) => {
      const parsedEvent = JSON.parse(event.data);
      if (!parsedEvent.timestamp) {
        parsedEvent.timestamp = new Date().toLocaleTimeString();
      }

      setEvents((previous) => [parsedEvent, ...previous]);
    };

    const handleOpen = () => {
      setIsSessionActive(true);
      setEvents([]);
    };

    dataChannel.addEventListener("message", handleMessage);
    dataChannel.addEventListener("open", handleOpen);

    return () => {
      dataChannel.removeEventListener("message", handleMessage);
      dataChannel.removeEventListener("open", handleOpen);
    };
  }, [dataChannel]);

  return (
    <>
      <nav className="absolute top-0 left-0 right-0 h-16 flex items-center">
        <div className="flex items-center gap-4 w-full m-4 pb-2 border-0 border-b border-solid border-gray-200">
          <img style={{ width: "24px" }} src={logo} />
          <h1>realtime console</h1>
        </div>
      </nav>
      <main className="absolute top-16 left-0 right-0 bottom-0">
        <section className="absolute top-0 left-0 right-[380px] bottom-0 flex flex-col gap-4 p-4 pr-0">
          <div className="h-[360px] min-h-[320px]">
            <MapPanel
              isSessionActive={isSessionActive}
              onSnapshot={handleMapSnapshot}
            />
          </div>
          <section className="flex-1 flex flex-col min-h-0 gap-4">
            <div className="flex-1 overflow-y-auto pr-4">
              <EventLog events={events} />
            </div>
            <div className="h-32">
              <SessionControls
                startSession={startSession}
                stopSession={stopSession}
                sendClientEvent={sendClientEvent}
                sendTextMessage={sendTextMessage}
                events={events}
                isSessionActive={isSessionActive}
              />
            </div>
          </section>
        </section>
        <section className="absolute top-0 w-[380px] right-0 bottom-0 p-4 pt-0 overflow-y-auto">
          <ToolPanel snapshots={snapshots} isSessionActive={isSessionActive} />
        </section>
      </main>
    </>
  );
}
