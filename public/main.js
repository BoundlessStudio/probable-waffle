const chatLog = document.getElementById("chatLog");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const micButton = document.getElementById("micButton");
const triggerResponseButton = document.getElementById("triggerResponse");
const connectionStatus = document.getElementById("connectionStatus");
const lastSnapshotImg = document.getElementById("lastSnapshot");

const remoteAudio = new Audio();
remoteAudio.autoplay = true;
remoteAudio.playsInline = true;
remoteAudio.hidden = true;
document.body.appendChild(remoteAudio);

let peerConnection;
let dataChannel;
let localStream;
let recognition;
let recognitionActive = false;
let map;
let mapIdleTimer;
let lastSnapshotDataUrl = "";
let assistantMessageBuffer = "";
let lastDisplayedUserText = "";
const pendingEvents = [];

async function init() {
  try {
    await loadGoogleMaps();
    await initializeMap();
  } catch (error) {
    console.error("Failed to load Google Maps", error);
    updateStatus("Failed to load Google Maps script. Check your API key.");
    return;
  }

  await setupRealtimeConnection();
  setupEventListeners();
}

document.addEventListener("DOMContentLoaded", init);

function updateStatus(message) {
  connectionStatus.textContent = message;
}

function addMessage(role, text) {
  const message = document.createElement("div");
  message.classList.add("message", role);
  message.textContent = text;
  chatLog.appendChild(message);
  chatLog.scrollTop = chatLog.scrollHeight;

  if (role === "user") {
    lastDisplayedUserText = text;
  }
}

function ensurePeerConnection() {
  if (peerConnection) return peerConnection;

  peerConnection = new RTCPeerConnection();

  peerConnection.addEventListener("track", (event) => {
    const [stream] = event.streams;
    if (stream) {
      remoteAudio.srcObject = stream;
    }
  });

  peerConnection.addEventListener("connectionstatechange", () => {
    updateStatus(`Connection state: ${peerConnection.connectionState}`);
  });

  dataChannel = peerConnection.createDataChannel("oai-events");
  dataChannel.addEventListener("open", () => {
    updateStatus("Connected. You can start chatting.");
    flushPendingEvents();
  });

  dataChannel.addEventListener("message", (event) => {
    handleRealtimeEvent(event.data);
  });

  peerConnection.addEventListener("datachannel", (event) => {
    if (event.channel.label === "oai-events") {
      dataChannel = event.channel;
      dataChannel.addEventListener("message", (evt) => handleRealtimeEvent(evt.data));
      dataChannel.addEventListener("open", flushPendingEvents);
    }
  });

  return peerConnection;
}

async function setupRealtimeConnection() {
  try {
    updateStatus("Requesting realtime session…");
    const response = await fetch("/session");
    if (!response.ok) {
      throw new Error(`Failed to fetch session: ${response.status}`);
    }

    const session = await response.json();
    const clientSecret = session?.client_secret?.value;
    const model = session?.model || "gpt-realtime-preview";

    if (!clientSecret) {
      throw new Error("Missing client secret in session response");
    }

    const pc = ensurePeerConnection();

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch(`https://api.openai.com/v1/realtime?model=${model}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp,
    });

    if (!sdpResponse.ok) {
      const text = await sdpResponse.text();
      throw new Error(`Realtime API rejected SDP: ${text}`);
    }

    const answer = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };

    await pc.setRemoteDescription(answer);
    updateStatus("Realtime session ready.");
  } catch (error) {
    console.error("Failed to set up realtime connection", error);
    updateStatus("Failed to connect to realtime service. Check console for details.");
  }
}

function sendEvent(payload) {
  const message = JSON.stringify(payload);
  if (dataChannel && dataChannel.readyState === "open") {
    dataChannel.send(message);
  } else {
    pendingEvents.push(message);
  }
}

function flushPendingEvents() {
  if (!dataChannel || dataChannel.readyState !== "open") return;
  while (pendingEvents.length) {
    const next = pendingEvents.shift();
    dataChannel.send(next);
  }
}

function sendConversationItem(role, type, data) {
  sendEvent({
    type: "conversation.item.create",
    item: {
      type: "message",
      role,
      content: [
        {
          type,
          ...data,
        },
      ],
    },
  });
}

function requestAssistantResponse() {
  sendEvent({ type: "response.create" });
}

function setupEventListeners() {
  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    addMessage("user", text);
    sendConversationItem("user", "input_text", { text });
    requestAssistantResponse();
    chatInput.value = "";
  });

  triggerResponseButton.addEventListener("click", () => {
    requestAssistantResponse();
  });

  micButton.addEventListener("click", toggleMicrophone);
}

async function toggleMicrophone() {
  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream.getTracks().forEach((track) => {
        const sender = ensurePeerConnection().addTrack(track, localStream);
        track.enabled = true;
        track.__sender = sender;
      });
      micButton.textContent = "🎙️ Stop Mic";
      startSpeechRecognition();
    } catch (error) {
      console.error("Failed to access microphone", error);
      updateStatus("Microphone access denied or unavailable.");
      return;
    }
  } else {
    localStream.getTracks().forEach((track) => {
      const sender = track.__sender;
      if (sender) {
        ensurePeerConnection().removeTrack(sender);
      }
      track.stop();
    });
    localStream = null;
    micButton.textContent = "🎙️ Start Mic";
    stopSpeechRecognition();
  }
}

function startSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition || recognitionActive) return;

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.addEventListener("result", (event) => {
    const transcript = Array.from(event.results)
      .map((result) => result[0].transcript)
      .join(" ")
      .trim();

    if (transcript) {
      addMessage("user", transcript);
      sendConversationItem("user", "input_text", { text: transcript });
    }
  });

  recognition.addEventListener("end", () => {
    if (recognitionActive) {
      recognition.start();
    }
  });

  recognition.start();
  recognitionActive = true;
}

function stopSpeechRecognition() {
  if (recognition && recognitionActive) {
    recognitionActive = false;
    recognition.stop();
  }
}

async function loadGoogleMaps() {
  if (window.google && window.google.maps) return;
  if (!window.GOOGLE_MAPS_API_KEY) {
    throw new Error("Google Maps API key not configured.");
  }

  return new Promise((resolve, reject) => {
    window.initGoogleMap = () => resolve();
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${window.GOOGLE_MAPS_API_KEY}&callback=initGoogleMap`;
    script.async = true;
    script.onerror = (error) => reject(error);
    document.head.appendChild(script);
  });
}

async function initializeMap() {
  const defaultCenter = { lat: 37.7749, lng: -122.4194 };
  const mapOptions = {
    zoom: 13,
    center: defaultCenter,
    disableDefaultUI: false,
  };

  map = new google.maps.Map(document.getElementById("map"), mapOptions);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        map.setCenter({ lat: latitude, lng: longitude });
      },
      (error) => {
        console.warn("Geolocation unavailable", error);
      }
    );
  }

  map.addListener("idle", () => {
    clearTimeout(mapIdleTimer);
    mapIdleTimer = setTimeout(captureMapSnapshot, 350);
  });

  await captureMapSnapshot();
}

async function captureMapSnapshot() {
  if (!map) return;
  const mapElement = map.getDiv();
  try {
    const canvas = await html2canvas(mapElement, {
      useCORS: true,
      backgroundColor: null,
    });
    const dataUrl = canvas.toDataURL("image/png");
    if (!dataUrl || dataUrl === lastSnapshotDataUrl) return;
    lastSnapshotDataUrl = dataUrl;

    lastSnapshotImg.src = dataUrl;
    lastSnapshotImg.alt = "Captured map snapshot";

    console.log("Sending map snapshot to conversation context");
    sendConversationItem("user", "input_image", { image_url: dataUrl });
  } catch (error) {
    console.error("Failed to capture map snapshot", error);
  }
}

function handleRealtimeEvent(rawEvent) {
  try {
    const event = JSON.parse(rawEvent);

    switch (event.type) {
      case "response.created":
        assistantMessageBuffer = "";
        break;
      case "response.output_text.delta":
        assistantMessageBuffer += event.delta;
        updateAssistantPreview(assistantMessageBuffer);
        break;
      case "response.completed":
        commitAssistantMessage();
        break;
      case "response.error":
        console.error("Assistant error", event.error);
        break;
      case "conversation.item.created":
        handleConversationItem(event.item);
        break;
      default:
        break;
    }
  } catch (error) {
    console.error("Failed to handle realtime event", error, rawEvent);
  }
}

function updateAssistantPreview(text) {
  if (!text) return;
  let preview = chatLog.querySelector(".message.assistant.preview");
  if (!preview) {
    preview = document.createElement("div");
    preview.classList.add("message", "assistant", "preview");
    chatLog.appendChild(preview);
  }
  preview.textContent = text;
  chatLog.scrollTop = chatLog.scrollHeight;
}

function commitAssistantMessage() {
  const preview = chatLog.querySelector(".message.assistant.preview");
  if (preview) {
    preview.classList.remove("preview");
  }
  if (assistantMessageBuffer.trim()) {
    addMessage("assistant", assistantMessageBuffer.trim());
  }
  assistantMessageBuffer = "";
}

function handleConversationItem(item) {
  if (!item || item.type !== "message" || item.role !== "user") return;
  const textContent = item.content?.find((content) => content.type === "input_text");
  if (textContent?.text && textContent.text !== lastDisplayedUserText) {
    addMessage("user", textContent.text);
  }
}
