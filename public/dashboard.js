"use strict";

const WS_URL = "wss://web-socket-9wz7.onrender.com";
const FLUSH_INTERVAL_MS = 5000;
const MAX_REPLAY_DELAY_MS = 5000;

const vehicles = new Map();
let selectedVehicleId = null;
let socket = null;
let reconnectTimer = null;
let map = null;
let mapMarker = null;

// Recording state.
let isRecording = false;
let recordingVehicleId = null;
let recordingVehicleName = null;
let recordingFileHandle = null;
let recordingFileName = null;
let recordingBuffer = [];
let recordingFlushTimer = null;
let recordingWriteChain = Promise.resolve();
let recordingFrameCount = 0;
let recordingWrittenCount = 0;
let recordingStartedAt = null;
let recordingFailed = false;

// Replay state. Frames are NOT loaded into RAM. We build a compact byte-offset index.
let replayFile = null;
let replayFileName = null;
let replayEntries = []; // { start, end, receivedAt }
let replayIndex = -1;
let replayPlaying = false;
let replayTimer = null;
let replayGeneration = 0;

const $ = (id) => document.getElementById(id);
const modeBadge = $("modeBadge");
const connectionStatus = $("connectionStatus");
const vehicleCount = $("vehicleCount");
const vehicleList = $("vehicleList");
const startRecordingButton = $("startRecordingButton");
const stopRecordingButton = $("stopRecordingButton");
const openRecordingButton = $("openRecordingButton");
const recordingFileInput = $("recordingFileInput");
const recordingStatus = $("recordingStatus");
const recordingFileNameElement = $("recordingFileName");
const bufferedCount = $("bufferedCount");
const writtenCount = $("writtenCount");
const previousFrameButton = $("previousFrameButton");
const playPauseButton = $("playPauseButton");
const nextFrameButton = $("nextFrameButton");
const exitReplayButton = $("exitReplayButton");
const replaySpeed = $("replaySpeed");
const replaySlider = $("replaySlider");
const replayPosition = $("replayPosition");
const replayStatus = $("replayStatus");

function initializeMap() {
  map = L.map("map").setView([54.6, -6.2], 9);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);
}

function setConnectionState(connected) {
  connectionStatus.textContent = connected ? "Connected" : "Disconnected";
  connectionStatus.className = `status ${connected ? "connected" : "disconnected"}`;
}

function connectWebSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  socket = new WebSocket(WS_URL);

  socket.addEventListener("open", () => {
    setConnectionState(true);
    socket.send(JSON.stringify({ type: "handshake", role: "browser" }));
  });

  socket.addEventListener("message", (event) => {
    try { handleServerMessage(JSON.parse(event.data)); }
    catch (error) { console.error("Invalid WebSocket message", error); }
  });

  socket.addEventListener("close", () => {
    setConnectionState(false);
    socket = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWebSocket, 2000);
  });

  socket.addEventListener("error", () => setConnectionState(false));
}

function handleServerMessage(message) {
  switch (message.type) {
    case "vehicle_list":
      if (Array.isArray(message.vehicles)) {
        for (const item of message.vehicles) upsertVehicle(item.vehicleId, item.vehicleName, true);
        renderVehicleList();
      }
      break;
    case "vehicle_connected":
      upsertVehicle(message.vehicleId, message.vehicleName, true);
      renderVehicleList();
      break;
    case "vehicle_disconnected": {
      const vehicle = vehicles.get(message.vehicleId);
      if (vehicle) vehicle.connected = false;
      renderVehicleList();
      break;
    }
    case "telemetry":
      handleTelemetry(message);
      break;
  }
}

function upsertVehicle(vehicleId, vehicleName, connected) {
  if (!vehicleId) return;
  const existing = vehicles.get(vehicleId) || {};
  vehicles.set(vehicleId, {
    vehicleId,
    vehicleName: vehicleName || existing.vehicleName || vehicleId,
    connected,
    telemetry: existing.telemetry || null,
    lastUpdate: existing.lastUpdate || null
  });
  if (!selectedVehicleId) selectedVehicleId = vehicleId;
}

function handleTelemetry(message) {
  if (!message.vehicleId || !message.data) return;
  upsertVehicle(message.vehicleId, message.vehicleName, true);
  const vehicle = vehicles.get(message.vehicleId);
  vehicle.telemetry = message.data;
  vehicle.lastUpdate = message.serverReceivedAt || Date.now();

  // Capture every message for the vehicle that was selected when recording started.
  if (isRecording && !recordingFailed && message.vehicleId === recordingVehicleId) {
    recordingBuffer.push({
      recordType: "telemetry",
      frameIndex: recordingFrameCount++,
      receivedAt: message.serverReceivedAt || Date.now(),
      data: structuredClone(message.data)
    });
    bufferedCount.textContent = String(recordingBuffer.length);
  }

  if (!replayFile && message.vehicleId === selectedVehicleId) displayTelemetry(message.data);
  renderVehicleList();
}

function renderVehicleList() {
  const sorted = [...vehicles.values()];
  sorted.sort((a, b) => {
    if (a.vehicleId === selectedVehicleId) return -1;
    if (b.vehicleId === selectedVehicleId) return 1;
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    return a.vehicleName.localeCompare(b.vehicleName);
  });

  vehicleCount.textContent = String(sorted.length);
  vehicleList.innerHTML = "";
  if (!sorted.length) {
    vehicleList.innerHTML = '<div class="empty">Waiting for vehicles...</div>';
    updateControlStates();
    return;
  }

  for (const vehicle of sorted) {
    const button = document.createElement("button");
    button.className = `vehicle${vehicle.vehicleId === selectedVehicleId ? " selected" : ""}`;
    button.innerHTML = `${vehicle.vehicleId === selectedVehicleId ? '<span class="selected-label">SELECTED</span>' : ""}` +
      `<span class="vehicle-name">${escapeHtml(vehicle.vehicleName)}</span>` +
      `<span class="vehicle-id">${escapeHtml(vehicle.vehicleId)}</span>` +
      `<span class="vehicle-state">${vehicle.connected ? "Online" : "Offline"}</span>`;
    button.addEventListener("click", () => selectVehicle(vehicle.vehicleId));
    vehicleList.appendChild(button);
  }
  updateControlStates();
}

function selectVehicle(vehicleId) {
  selectedVehicleId = vehicleId;
  renderVehicleList();
  if (!replayFile) {
    const vehicle = vehicles.get(vehicleId);
    vehicle?.telemetry ? displayTelemetry(vehicle.telemetry) : clearDashboard();
  }
}

function displayTelemetry(data) {
  $("frameNumber").textContent = data?.frameNumber ?? "--";
  $("speed").textContent = Number.isFinite(Number(data?.speed)) ? `${Number(data.speed).toFixed(1)}` : "--";
  $("latitude").textContent = Number.isFinite(Number(data?.location?.latitude)) ? Number(data.location.latitude).toFixed(6) : "--";
  $("longitude").textContent = Number.isFinite(Number(data?.location?.longitude)) ? Number(data.location.longitude).toFixed(6) : "--";
  const objects = Array.isArray(data?.detectedObjects) ? data.detectedObjects : [];
  $("objectCount").textContent = String(objects.length);
  $("rawTelemetry").textContent = JSON.stringify(data, null, 2);

  const objectList = $("objectList");
  objectList.innerHTML = objects.length ? "" : '<div class="empty">No detected objects</div>';
  for (const object of objects) {
    const div = document.createElement("div");
    div.className = "object-item";
    div.innerHTML = `<span class="object-type">${escapeHtml(object.type ?? "object")} #${escapeHtml(String(object.id ?? "--"))}</span>` +
      `<span class="object-details">x=${object.x ?? "--"}, y=${object.y ?? "--"}, w=${object.width ?? "--"}, h=${object.height ?? "--"}</span>`;
    objectList.appendChild(div);
  }

  const lat = Number(data?.location?.latitude);
  const lon = Number(data?.location?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    if (!mapMarker) mapMarker = L.marker([lat, lon]).addTo(map);
    else mapMarker.setLatLng([lat, lon]);
    map.setView([lat, lon], Math.max(map.getZoom(), 14));
  }
}

function clearDashboard() {
  for (const id of ["frameNumber", "speed", "latitude", "longitude", "objectCount"]) $(id).textContent = "--";
  $("objectList").innerHTML = '<div class="empty">No telemetry</div>';
  $("rawTelemetry").textContent = "Waiting for telemetry...";
  if (mapMarker) { map.removeLayer(mapMarker); mapMarker = null; }
}

function makeRecordingFilename(vehicleId) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${vehicleId}_${stamp}.jsonl`;
}

async function startRecording() {
  if (isRecording || !selectedVehicleId) return;
  if (!("showSaveFilePicker" in window)) {
    alert("This browser does not support direct file recording with showSaveFilePicker(). Use a current browser that supports the File System Access API over HTTPS.");
    return;
  }

  const vehicle = vehicles.get(selectedVehicleId);
  try {
    recordingFileHandle = await window.showSaveFilePicker({
      suggestedName: makeRecordingFilename(selectedVehicleId),
      types: [{ description: "JSON Lines telemetry recording", accept: { "application/x-ndjson": [".jsonl", ".ndjson"] } }]
    });
  } catch (error) {
    if (error.name !== "AbortError") console.error(error);
    return;
  }

  recordingVehicleId = selectedVehicleId;
  recordingVehicleName = vehicle?.vehicleName || selectedVehicleId;
  recordingFileName = recordingFileHandle.name;
  recordingBuffer = [];
  recordingFrameCount = 0;
  recordingWrittenCount = 0;
  recordingStartedAt = new Date().toISOString();
  recordingFailed = false;
  recordingWriteChain = Promise.resolve();

  try {
    // Create/truncate and commit the header immediately.
    const writable = await recordingFileHandle.createWritable({ mode: "exclusive" });
    const header = {
      recordType: "header",
      formatVersion: 1,
      vehicleId: recordingVehicleId,
      vehicleName: recordingVehicleName,
      startedAt: recordingStartedAt
    };
    await writable.write(JSON.stringify(header) + "\n");
    await writable.close();
  } catch (error) {
    console.error("Unable to initialize recording file", error);
    alert(`Unable to initialize recording file:\n${error.message}`);
    resetRecordingState();
    return;
  }

  isRecording = true;
  recordingStatus.textContent = "Recording";
  recordingFileNameElement.textContent = recordingFileName;
  bufferedCount.textContent = "0";
  writtenCount.textContent = "0";
  recordingFlushTimer = setInterval(() => { void flushRecordingBuffer(); }, FLUSH_INTERVAL_MS);
  updateControlStates();
}

function queueAppendText(text, count) {
  recordingWriteChain = recordingWriteChain
    .catch((error) => {
      console.error("Previous recording write failed", error);
      // Recover the chain so a transient failure doesn't permanently poison it.
    })
    .then(async () => {
      if (!recordingFileHandle) throw new Error("Recording file handle is unavailable");
      const existingFile = await recordingFileHandle.getFile();
      const writable = await recordingFileHandle.createWritable({ keepExistingData: true, mode: "exclusive" });
      await writable.seek(existingFile.size);
      await writable.write(text);
      await writable.close(); // commit this batch to the user-visible file
      recordingWrittenCount += count;
      writtenCount.textContent = String(recordingWrittenCount);
    })
    .catch((error) => {
      recordingFailed = true;
      recordingStatus.textContent = "Write error";
      console.error("Recording write failed", error);
      throw error;
    });
  return recordingWriteChain;
}

async function flushRecordingBuffer() {
  if (!recordingBuffer.length || !recordingFileHandle || recordingFailed) return;

  // Double-buffer: immediately swap so new WebSocket messages keep accumulating.
  const batch = recordingBuffer;
  recordingBuffer = [];
  bufferedCount.textContent = "0";
  const text = batch.map((entry) => JSON.stringify(entry)).join("\n") + "\n";

  try {
    await queueAppendText(text, batch.length);
  } catch (error) {
    // Preserve unwritten data in RAM if possible. Newer frames may already be in recordingBuffer.
    recordingBuffer = batch.concat(recordingBuffer);
    bufferedCount.textContent = String(recordingBuffer.length);
    console.error("Batch restored to RAM after write failure", error);
  }
}

async function stopRecording() {
  if (!isRecording) return;
  isRecording = false; // stop accepting new frames first
  clearInterval(recordingFlushTimer);
  recordingFlushTimer = null;
  recordingStatus.textContent = "Finishing...";
  updateControlStates();

  await flushRecordingBuffer();
  try { await recordingWriteChain.catch(() => {}); } catch (_) {}

  if (!recordingFailed && recordingFileHandle) {
    const footer = {
      recordType: "footer",
      stoppedAt: new Date().toISOString(),
      frameCount: recordingFrameCount,
      status: "completed"
    };
    try {
      await queueAppendText(JSON.stringify(footer) + "\n", 0);
      recordingStatus.textContent = `Saved ${recordingFrameCount} messages`;
    } catch (error) {
      recordingStatus.textContent = "Stopped with write error";
    }
  } else {
    recordingStatus.textContent = "Stopped with write error";
  }

  recordingFileHandle = null;
  recordingVehicleId = null;
  recordingVehicleName = null;
  recordingBuffer = [];
  bufferedCount.textContent = "0";
  updateControlStates();
}

function resetRecordingState() {
  isRecording = false;
  recordingFileHandle = null;
  recordingVehicleId = null;
  recordingVehicleName = null;
  recordingBuffer = [];
  recordingFrameCount = 0;
  recordingWrittenCount = 0;
  recordingFailed = false;
  clearInterval(recordingFlushTimer);
  recordingFlushTimer = null;
  recordingStatus.textContent = "Idle";
  recordingFileNameElement.textContent = "None";
  bufferedCount.textContent = "0";
  writtenCount.textContent = "0";
  updateControlStates();
}

async function openRecording() {
  if (isRecording) return;
  recordingFileInput.value = "";
  recordingFileInput.click();
}

recordingFileInput.addEventListener("change", async () => {
  const file = recordingFileInput.files?.[0];
  if (file) await loadReplayFile(file);
});

// Streaming indexer: scans the file chunk-by-chunk and stores only offsets/timestamps.
async function loadReplayFile(file) {
  stopReplayPlayback();
  const generation = ++replayGeneration;
  replayFile = file;
  replayFileName = file.name;
  replayEntries = [];
  replayIndex = -1;
  replayStatus.textContent = "Indexing recording...";
  setReplayMode(true);

  let byteOffset = 0;
  let pendingBytes = new Uint8Array(0);
  let header = null;
  const reader = file.stream().getReader();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (generation !== replayGeneration) { await reader.cancel(); return; }
      if (done) break;

      const combined = new Uint8Array(pendingBytes.length + value.length);
      combined.set(pendingBytes, 0);
      combined.set(value, pendingBytes.length);

      let lineStart = 0;
      for (let i = 0; i < combined.length; ++i) {
        if (combined[i] !== 10) continue; // '\n'
        let lineEnd = i;
        if (lineEnd > lineStart && combined[lineEnd - 1] === 13) --lineEnd; // CRLF
        const lineBytes = combined.subarray(lineStart, lineEnd);
        const start = byteOffset + lineStart - pendingBytes.length;
        const end = byteOffset + i + 1 - pendingBytes.length;
        if (lineBytes.length) {
          const record = JSON.parse(new TextDecoder().decode(lineBytes));
          if (record.recordType === "header") header = record;
          else if (record.recordType === "telemetry") {
            replayEntries.push({ start, end, receivedAt: Number(record.receivedAt) || 0 });
          }
        }
        lineStart = i + 1;
      }
      pendingBytes = combined.slice(lineStart);
      byteOffset += value.length;
      if (replayEntries.length % 5000 < 100) replayStatus.textContent = `Indexing... ${replayEntries.length.toLocaleString()} messages`;
    }

    // Handle final non-newline-terminated record, useful for interrupted files.
    if (pendingBytes.length) {
      try {
        const record = JSON.parse(new TextDecoder().decode(pendingBytes));
        if (record.recordType === "telemetry") replayEntries.push({
          start: file.size - pendingBytes.length,
          end: file.size,
          receivedAt: Number(record.receivedAt) || 0
        });
      } catch (_) { /* incomplete crash tail: ignore it */ }
    }
  } catch (error) {
    console.error("Unable to index recording", error);
    alert(`Unable to open recording:\n${error.message}`);
    exitReplay();
    return;
  }

  if (!replayEntries.length) {
    alert("The selected file contains no telemetry records.");
    exitReplay();
    return;
  }

  if (header?.vehicleId) {
    upsertVehicle(header.vehicleId, header.vehicleName || header.vehicleId, false);
    selectedVehicleId = header.vehicleId;
    renderVehicleList();
  }

  replaySlider.min = "0";
  replaySlider.max = String(replayEntries.length - 1);
  replaySlider.value = "0";
  replayStatus.textContent = `${file.name} — ${replayEntries.length.toLocaleString()} messages`;
  updateControlStates();
  await showReplayFrame(0);
}

async function readReplayRecord(index) {
  if (!replayFile || index < 0 || index >= replayEntries.length) return null;
  const entry = replayEntries[index];
  const text = await replayFile.slice(entry.start, entry.end).text();
  return JSON.parse(text.trim());
}

async function showReplayFrame(index) {
  if (!replayFile || !replayEntries.length) return;
  index = Math.max(0, Math.min(index, replayEntries.length - 1));
  const record = await readReplayRecord(index);
  if (!record?.data) return;
  replayIndex = index;
  replaySlider.value = String(index);
  replayPosition.textContent = `${(index + 1).toLocaleString()} / ${replayEntries.length.toLocaleString()}`;
  displayTelemetry(record.data);
  updateControlStates();
}

function stopReplayPlayback() {
  replayPlaying = false;
  clearTimeout(replayTimer);
  replayTimer = null;
  playPauseButton.textContent = "Play";
}

async function playNextReplayFrame() {
  if (!replayPlaying || !replayFile) return;
  if (replayIndex >= replayEntries.length - 1) { stopReplayPlayback(); return; }

  const current = replayEntries[replayIndex];
  const next = replayEntries[replayIndex + 1];
  const speed = Math.max(0.01, Number(replaySpeed.value) || 1);
  let delay = next.receivedAt > current.receivedAt ? (next.receivedAt - current.receivedAt) / speed : 0;
  delay = Math.max(0, Math.min(delay, MAX_REPLAY_DELAY_MS));

  replayTimer = setTimeout(async () => {
    await showReplayFrame(replayIndex + 1);
    void playNextReplayFrame();
  }, delay);
}

function toggleReplayPlayback() {
  if (!replayFile) return;
  if (replayPlaying) { stopReplayPlayback(); return; }
  if (replayIndex >= replayEntries.length - 1) void showReplayFrame(0);
  replayPlaying = true;
  playPauseButton.textContent = "Pause";
  void playNextReplayFrame();
}

function setReplayMode(enabled) {
  modeBadge.textContent = enabled ? "REPLAY" : "LIVE";
  modeBadge.className = `badge ${enabled ? "replay" : "live"}`;
}

function exitReplay() {
  ++replayGeneration;
  stopReplayPlayback();
  replayFile = null;
  replayFileName = null;
  replayEntries = [];
  replayIndex = -1;
  replaySlider.value = "0";
  replaySlider.max = "0";
  replayPosition.textContent = "0 / 0";
  replayStatus.textContent = "No recording loaded";
  setReplayMode(false);
  const vehicle = selectedVehicleId ? vehicles.get(selectedVehicleId) : null;
  vehicle?.telemetry ? displayTelemetry(vehicle.telemetry) : clearDashboard();
  updateControlStates();
}

function updateControlStates() {
  const selected = selectedVehicleId ? vehicles.get(selectedVehicleId) : null;
  startRecordingButton.disabled = isRecording || !!replayFile || !selected || !selected.connected;
  stopRecordingButton.disabled = !isRecording;
  openRecordingButton.disabled = isRecording;
  const hasReplay = !!replayFile && replayEntries.length > 0;
  previousFrameButton.disabled = !hasReplay || replayIndex <= 0;
  playPauseButton.disabled = !hasReplay;
  nextFrameButton.disabled = !hasReplay || replayIndex >= replayEntries.length - 1;
  exitReplayButton.disabled = !replayFile;
  replaySpeed.disabled = !hasReplay;
  replaySlider.disabled = !hasReplay;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}

startRecordingButton.addEventListener("click", () => void startRecording());
stopRecordingButton.addEventListener("click", () => void stopRecording());
openRecordingButton.addEventListener("click", () => void openRecording());
previousFrameButton.addEventListener("click", () => { stopReplayPlayback(); void showReplayFrame(replayIndex - 1); });
nextFrameButton.addEventListener("click", () => { stopReplayPlayback(); void showReplayFrame(replayIndex + 1); });
playPauseButton.addEventListener("click", toggleReplayPlayback);
exitReplayButton.addEventListener("click", exitReplay);
replaySlider.addEventListener("input", () => { stopReplayPlayback(); void showReplayFrame(Number(replaySlider.value)); });

// Do not attempt asynchronous final file writes during page unload; browsers do not guarantee them.
window.addEventListener("beforeunload", (event) => {
  if (isRecording && recordingBuffer.length) {
    event.preventDefault();
    event.returnValue = "";
  }
});

initializeMap();
clearDashboard();
renderVehicleList();
connectWebSocket();

