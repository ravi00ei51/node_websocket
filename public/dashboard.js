// ============================================================
// WebSocket
// ============================================================

const wsProtocol =
    window.location.protocol === "https:"
        ? "wss:"
        : "ws:";


const WEBSOCKET_URL =
    `${wsProtocol}//${window.location.host}`;


let socket = null;
let reconnectTimer = null;
let totalMessageCount = 0;



// ============================================================
// Vehicles
// ============================================================

const vehicles =
    new Map();


let selectedVehicleId =
    null;



// ============================================================
// Portable JSONL Recording
// ============================================================

const RECORDING_FLUSH_INTERVAL_MS =
    5000;

let isRecording =
    false;

let recordingVehicleId =
    null;

let recordingVehicleName =
    null;

let recordingFrameIndex =
    0;

let recordingBuffer =
    [];

let recordingFlushTimer =
    null;

let recordingWriteChain =
    Promise.resolve();

let recordingFileHandle =
    null;

let recordingFileName =
    null;

let recordingStartedAt =
    null;


// ============================================================
// JSONL Replay
// ============================================================

let replayRecordingId =
    null;

let replayVehicleId =
    null;

let replayFrameCount =
    0;

let replayIndex =
    0;

let replayPlaying =
    false;

let replayTimer =
    null;

let replayFile =
    null;

let replayFileHandle =
    null;

let replayFrameIndex =
    [];

let replayHeader =
    null;

let lastRecordingAvailable =
    false;


// ============================================================
// Map
// ============================================================

const map =
    L.map(
        "map"
    ).setView(
        [
            54.7,
            -6.2
        ],
        10
    );

L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        maxZoom:
            19,

        attribution:
            "&copy; OpenStreetMap contributors"
    }
).addTo(
    map
);

let vehicleMarker =
    null;

let firstPosition =
    true;


// ============================================================
// UI
// ============================================================

const startRecordingButton =
    document.getElementById(
        "startRecordingButton"
    );

const stopRecordingButton =
    document.getElementById(
        "stopRecordingButton"
    );

const saveRecordingButton =
    document.getElementById(
        "saveRecordingButton"
    );

const deleteRecordingButton =
    document.getElementById(
        "deleteRecordingButton"
    );

const recordingSelect =
    document.getElementById(
        "recordingSelect"
    );

const recordingFileInput =
    document.getElementById(
        "recordingFileInput"
    );

const replayLastButton =
    document.getElementById(
        "replayLastButton"
    );

const loadReplayButton =
    document.getElementById(
        "loadReplayButton"
    );

const playReplayButton =
    document.getElementById(
        "playReplayButton"
    );

const stopReplayButton =
    document.getElementById(
        "stopReplayButton"
    );

const previousFrameButton =
    document.getElementById(
        "previousFrameButton"
    );

const nextFrameButton =
    document.getElementById(
        "nextFrameButton"
    );

const replaySlider =
    document.getElementById(
        "replaySlider"
    );

const replaySpeed =
    document.getElementById(
        "replaySpeed"
    );


// ============================================================
// Helpers
// ============================================================

function safeFilePart(
    value
)
{
    return String(
        value ?? "vehicle"
    ).replace(
        /[^a-zA-Z0-9_.-]+/g,
        "_"
    );
}


function makeRecordingFileName()
{
    const timestamp =
        new Date()
            .toISOString()
            .replace(
                /[:.]/g,
                "-"
            );

    return (
        `${safeFilePart(recordingVehicleId)}_` +
        `${timestamp}.jsonl`
    );
}


async function appendTextToRecordingFile(
    text
)
{
    if (!recordingFileHandle)
    {
        throw new Error(
            "No recording file is open"
        );
    }

    /*
     * createWritable() normally writes through a temporary file and
     * commits the changes when close() succeeds.
     *
     * We therefore reopen + seek + append + close for every batch.
     * This bounds RAM usage and commits every completed 5-second batch.
     */
    const existingFile =
        await recordingFileHandle.getFile();

    const writable =
        await recordingFileHandle.createWritable(
            {
                keepExistingData:
                    true
            }
        );

    try
    {
        await writable.seek(
            existingFile.size
        );

        await writable.write(
            text
        );

        await writable.close();
    }
    catch (error)
    {
        try
        {
            await writable.abort();
        }
        catch
        {
        }

        throw error;
    }
}


function framesToJsonl(
    frames
)
{
    return (
        frames.map(
            frame =>
                JSON.stringify(
                    {
                        recordType:
                            "telemetry",

                        frameIndex:
                            frame.frameIndex,

                        receivedAt:
                            frame.receivedAt,

                        data:
                            frame.data
                    }
                )
        ).join(
            "\n"
        )
        +
        "\n"
    );
}


// ============================================================
// Flush Current RAM Buffer
// ============================================================

function flushRecordingBuffer()
{
    if (
        recordingBuffer.length === 0 ||
        !recordingFileHandle
    )
    {
        return recordingWriteChain;
    }

    /*
     * Double-buffering:
     * WebSocket telemetry immediately starts filling a fresh array
     * while the old batch is serialized and committed to disk.
     */
    const batch =
        recordingBuffer;

    recordingBuffer =
        [];

    recordingWriteChain =
        recordingWriteChain
            .catch(
                () =>
                {
                    /*
                     * A previous failed batch has already been requeued.
                     * Reset the chain so a later explicit retry can run.
                     */
                }
            )
            .then(
                async () =>
                {
                    try
                    {
                        const text =
                            framesToJsonl(
                                batch
                            );

                        await appendTextToRecordingFile(
                            text
                        );

                        console.log(
                            `JSONL batch committed: ${batch.length} messages`
                        );
                    }
                    catch (error)
                    {
                        /*
                         * Put failed messages back in front, preserving order.
                         */
                        recordingBuffer =
                            batch.concat(
                                recordingBuffer
                            );

                        document.getElementById(
                            "recordingStatus"
                        ).textContent =
                            "Recording write error - data kept in RAM";

                        throw error;
                    }
                }
            );

    return recordingWriteChain;
}


// ============================================================
// Start Recording
// ============================================================

async function startRecording()
{
    if (
        !selectedVehicleId ||
        isRecording
    )
    {
        return;
    }

    if (
        !("showSaveFilePicker" in window)
    )
    {
        alert(
            "This browser does not support direct file recording. " +
            "Use a Chromium-based browser with the File System Access API."
        );

        return;
    }

    exitReplayMode();

    const vehicle =
        vehicles.get(
            selectedVehicleId
        );

    recordingVehicleId =
        selectedVehicleId;

    recordingVehicleName =
        vehicle?.vehicleName
        ??
        selectedVehicleId;

    try
    {
        recordingFileHandle =
            await window.showSaveFilePicker(
                {
                    suggestedName:
                        makeRecordingFileName(),

                    types:
                        [
                            {
                                description:
                                    "JSON Lines telemetry recording",

                                accept:
                                    {
                                        "application/x-ndjson":
                                            [
                                                ".jsonl",
                                                ".ndjson"
                                            ]
                                    }
                            }
                        ]
                }
            );
    }
    catch (error)
    {
        recordingVehicleId =
            null;

        recordingVehicleName =
            null;

        if (
            error?.name !==
            "AbortError"
        )
        {
            console.error(
                "Unable to choose recording file:",
                error
            );
        }

        return;
    }

    recordingFileName =
        recordingFileHandle.name;

    recordingStartedAt =
        new Date()
            .toISOString();

    recordingFrameIndex =
        0;

    recordingBuffer =
        [];

    recordingWriteChain =
        Promise.resolve();

    try
    {
        /*
         * Truncate an existing file selected by the user and write
         * the header as the first committed JSONL record.
         */
        const writable =
            await recordingFileHandle.createWritable();

        await writable.write(
            JSON.stringify(
                {
                    recordType:
                        "header",

                    formatVersion:
                        1,

                    vehicleId:
                        recordingVehicleId,

                    vehicleName:
                        recordingVehicleName,

                    startedAt:
                        recordingStartedAt
                }
            )
            +
            "\n"
        );

        await writable.close();
    }
    catch (error)
    {
        console.error(
            "Unable to initialize recording file:",
            error
        );

        alert(
            "Unable to initialize the recording file."
        );

        recordingFileHandle =
            null;

        return;
    }

    isRecording =
        true;

    recordingFlushTimer =
        setInterval(
            () =>
            {
                flushRecordingBuffer()
                    .catch(
                        error =>
                        {
                            console.error(
                                "Periodic JSONL flush failed:",
                                error
                            );
                        }
                    );
            },
            RECORDING_FLUSH_INTERVAL_MS
        );

    startRecordingButton.disabled =
        true;

    stopRecordingButton.disabled =
        false;

    document.getElementById(
        "recordingStatus"
    ).textContent =
        `Recording ${recordingVehicleId} - 0 messages`;
}


// ============================================================
// Stop Recording
// ============================================================

async function stopRecording()
{
    if (!isRecording)
    {
        return;
    }

    /*
     * Stop accepting new telemetry before flushing.
     */
    isRecording =
        false;

    if (recordingFlushTimer)
    {
        clearInterval(
            recordingFlushTimer
        );

        recordingFlushTimer =
            null;
    }

    const finishedVehicleId =
        recordingVehicleId;

    const totalFrames =
        recordingFrameIndex;

    let completed =
        false;

    try
    {
        await flushRecordingBuffer();

        await recordingWriteChain;

        if (
            recordingBuffer.length > 0
        )
        {
            /*
             * Retry once if a previous batch was requeued.
             */
            await flushRecordingBuffer();

            await recordingWriteChain;
        }

        const footer =
            JSON.stringify(
                {
                    recordType:
                        "footer",

                    stoppedAt:
                        new Date()
                            .toISOString(),

                    frameCount:
                        totalFrames,

                    status:
                        "completed"
                }
            )
            +
            "\n";

        await appendTextToRecordingFile(
            footer
        );

        completed =
            true;

        document.getElementById(
            "recordingStatus"
        ).textContent =
            `${finishedVehicleId}: ${totalFrames} messages recorded`;
    }
    catch (error)
    {
        console.error(
            "Unable to finish recording:",
            error
        );

        document.getElementById(
            "recordingStatus"
        ).textContent =
            `Recording write error - ${recordingBuffer.length} messages remain in RAM`;

        alert(
            "The recording could not be completely written. " +
            "Do not close this page if you want to retry."
        );
    }

    if (completed)
    {
        recordingFileHandle =
            null;

        recordingVehicleId =
            null;

        recordingVehicleName =
            null;

        recordingBuffer =
            [];

        recordingFrameIndex =
            0;

        recordingStartedAt =
            null;

        startRecordingButton.disabled =
            selectedVehicleId === null;

        stopRecordingButton.disabled =
            true;
    }
}


// ============================================================
// Handle Telemetry
// ============================================================

function handleTelemetry(
    message
)
{
    const vehicleId =
        message.vehicleId;


    let vehicle =
        vehicles.get(
            vehicleId
        );


    if (!vehicle)
    {
        vehicle =
            {
                vehicleId:
                    vehicleId,

                vehicleName:
                    message.vehicleName
                    ??
                    vehicleId,

                connected:
                    true,

                lastUpdate:
                    null,

                telemetry:
                    null
            };


        vehicles.set(
            vehicleId,
            vehicle
        );
    }


    vehicle.connected =
        true;


    vehicle.telemetry =
        message.data;


    vehicle.lastUpdate =
        Date.now();


    totalMessageCount++;


    document.getElementById(
        "messageCount"
    ).textContent =
        totalMessageCount;



    // ========================================================
    // RECORD EVERY MESSAGE
    // ========================================================

    if (
        isRecording &&
        vehicleId === recordingVehicleId
    )
    {
        recordingBuffer.push(
            {
                frameIndex:
                    recordingFrameIndex++,

                receivedAt:
                    message.serverReceivedAt
                    ??
                    Date.now(),

                data:
                    structuredClone(
                        message.data
                    )
            }
        );


        document.getElementById(
            "recordingStatus"
        ).textContent =
            `Recording ${recordingVehicleId} - ` +
            `${recordingFrameIndex} messages`;
    }



    // ========================================================
    // Display
    // ========================================================

    if (
        replayRecordingId === null &&
        vehicleId === selectedVehicleId
    )
    {
        updateDashboard(
            message.data
        );
    }


    updateVehicleList();
}



// ============================================================
// Vehicle List Message
// ============================================================

function handleVehicleList(
    serverVehicles
)
{
    const serverIds =
        new Set();


    serverVehicles.forEach(
        vehicleInfo =>
        {
            serverIds.add(
                vehicleInfo.vehicleId
            );


            let vehicle =
                vehicles.get(
                    vehicleInfo.vehicleId
                );


            if (!vehicle)
            {
                vehicle =
                    {
                        vehicleId:
                            vehicleInfo.vehicleId,

                        vehicleName:
                            vehicleInfo.vehicleName
                            ??
                            vehicleInfo.vehicleId,

                        connected:
                            true,

                        lastUpdate:
                            null,

                        telemetry:
                            null
                    };


                vehicles.set(
                    vehicle.vehicleId,
                    vehicle
                );
            }
            else
            {
                vehicle.connected =
                    true;


                vehicle.vehicleName =
                    vehicleInfo.vehicleName
                    ??
                    vehicle.vehicleId;
            }
        }
    );


    vehicles.forEach(
        vehicle =>
        {
            if (
                !serverIds.has(
                    vehicle.vehicleId
                )
            )
            {
                vehicle.connected =
                    false;
            }
        }
    );


    if (
        selectedVehicleId === null &&
        serverVehicles.length > 0
    )
    {
        selectVehicle(
            serverVehicles[0].vehicleId
        );
    }


    updateVehicleList();
}



// ============================================================
// Vehicle Connected
// ============================================================

function handleVehicleConnected(
    vehicleInfo
)
{
    let vehicle =
        vehicles.get(
            vehicleInfo.vehicleId
        );


    if (!vehicle)
    {
        vehicle =
            {
                vehicleId:
                    vehicleInfo.vehicleId,

                vehicleName:
                    vehicleInfo.vehicleName
                    ??
                    vehicleInfo.vehicleId,

                connected:
                    true,

                lastUpdate:
                    null,

                telemetry:
                    null
            };


        vehicles.set(
            vehicle.vehicleId,
            vehicle
        );
    }
    else
    {
        vehicle.connected =
            true;


        vehicle.vehicleName =
            vehicleInfo.vehicleName
            ??
            vehicle.vehicleId;
    }


    if (
        selectedVehicleId === null
    )
    {
        selectVehicle(
            vehicle.vehicleId
        );
    }


    updateVehicleList();
}



// ============================================================
// Vehicle Disconnected
// ============================================================

function handleVehicleDisconnected(
    vehicleId
)
{
    const vehicle =
        vehicles.get(
            vehicleId
        );


    if (vehicle)
    {
        vehicle.connected =
            false;
    }


    updateVehicleList();
}



// ============================================================
// Draw Vehicle List
// ============================================================

function updateVehicleList()
{
    const list =
        document.getElementById(
            "vehicleList"
        );


    list.innerHTML =
        "";


    document.getElementById(
        "vehicleCount"
    ).textContent =
        vehicles.size;


    if (
        vehicles.size === 0
    )
    {
        const empty =
            document.createElement(
                "div"
            );


        empty.className =
            "no-vehicles";


        empty.textContent =
            "Waiting for vehicles...";


        list.appendChild(
            empty
        );


        return;
    }


    const sorted =
        Array.from(
            vehicles.values()
        );


    sorted.sort(
        (a, b) =>
        {
            if (
                a.vehicleId ===
                selectedVehicleId
            )
            {
                return -1;
            }


            if (
                b.vehicleId ===
                selectedVehicleId
            )
            {
                return 1;
            }


            if (
                a.connected !==
                b.connected
            )
            {
                return a.connected
                    ? -1
                    : 1;
            }


            return a.vehicleName.localeCompare(
                b.vehicleName
            );
        }
    );


    sorted.forEach(
        vehicle =>
        {
            const selected =
                vehicle.vehicleId ===
                selectedVehicleId;


            const item =
                document.createElement(
                    "div"
                );


            item.className =
                "vehicle-item";


            if (selected)
            {
                item.classList.add(
                    "selected"
                );
            }


            item.addEventListener(
                "click",
                function ()
                {
                    selectVehicle(
                        vehicle.vehicleId
                    );
                }
            );


            const name =
                document.createElement(
                    "div"
                );


            name.className =
                "vehicle-name";


            name.textContent =
                vehicle.vehicleName;


            item.appendChild(
                name
            );


            if (selected)
            {
                const badge =
                    document.createElement(
                        "div"
                    );


                badge.className =
                    "selected-vehicle-badge";


                badge.textContent =
                    "SELECTED";


                item.appendChild(
                    badge
                );
            }


            const id =
                document.createElement(
                    "div"
                );


            id.className =
                "vehicle-id";


            id.textContent =
                vehicle.vehicleId;


            item.appendChild(
                id
            );


            const status =
                document.createElement(
                    "div"
                );


            status.className =
                "vehicle-status-row";


            const dot =
                document.createElement(
                    "div"
                );


            dot.className =
                vehicle.connected
                    ? "vehicle-online-dot"
                    : "vehicle-offline-dot";


            status.appendChild(
                dot
            );


            const text =
                document.createElement(
                    "span"
                );


            if (!vehicle.connected)
            {
                text.textContent =
                    "Offline";
            }
            else if (
                vehicle.lastUpdate === null
            )
            {
                text.textContent =
                    "Connected";
            }
            else
            {
                const seconds =
                    Math.floor(
                        (
                            Date.now() -
                            vehicle.lastUpdate
                        ) / 1000
                    );


                if (
                    seconds < 60
                )
                {
                    text.textContent =
                        `${seconds}s ago`;
                }
                else
                {
                    text.textContent =
                        `${Math.floor(
                            seconds / 60
                        )}m ago`;
                }
            }


            status.appendChild(
                text
            );


            item.appendChild(
                status
            );


            list.appendChild(
                item
            );
        }
    );
}



// ============================================================
// Select Vehicle
// ============================================================

async function selectVehicle(
    vehicleId
)
{
    if (
        selectedVehicleId ===
        vehicleId
    )
    {
        return;
    }


    if (isRecording)
    {
        const change =
            confirm(
                `Recording ${recordingVehicleId} is active.\n\n` +
                `Stop recording and switch to ${vehicleId}?`
            );


        if (!change)
        {
            return;
        }


        await stopRecording();
    }


    exitReplayMode();


    selectedVehicleId =
        vehicleId;


    firstPosition =
        true;


    const vehicle =
        vehicles.get(
            vehicleId
        );


    if (!vehicle)
    {
        return;
    }


    document.getElementById(
        "vehicleId"
    ).textContent =
        vehicle.vehicleId;


    document.getElementById(
        "mapVehicleName"
    ).textContent =
        vehicle.vehicleName;


    startRecordingButton.disabled =
        false;


    document.getElementById(
        "recordingStatus"
    ).textContent =
        "Not recording";


    if (
        vehicle.telemetry
    )
    {
        updateDashboard(
            vehicle.telemetry
        );
    }
    else
    {
        clearDashboard();
    }


    await refreshRecordingList();


    updateVehicleList();
}



// ============================================================
// WebSocket
// ============================================================

function connectWebSocket()
{
    if (
        socket &&
        (
            socket.readyState ===
                WebSocket.OPEN
            ||
            socket.readyState ===
                WebSocket.CONNECTING
        )
    )
    {
        return;
    }


    setConnectionStatus(
        "Connecting...",
        "connecting"
    );


    socket =
        new WebSocket(
            WEBSOCKET_URL
        );


    socket.onopen =
        function ()
        {
            socket.send(
                JSON.stringify(
                    {
                        type:
                            "handshake",

                        role:
                            "browser"
                    }
                )
            );
        };


    socket.onmessage =
        function (event)
        {
            let message;


            try
            {
                message =
                    JSON.parse(
                        event.data
                    );
            }
            catch
            {
                return;
            }


            switch (
                message.type
            )
            {
                case "handshake_ack":

                    setConnectionStatus(
                        "Connected",
                        "connected"
                    );

                    break;


                case "vehicle_list":

                    handleVehicleList(
                        message.vehicles
                        ??
                        []
                    );

                    break;


                case "vehicle_connected":

                    if (
                        message.vehicle
                    )
                    {
                        handleVehicleConnected(
                            message.vehicle
                        );
                    }

                    break;


                case "vehicle_disconnected":

                    handleVehicleDisconnected(
                        message.vehicleId
                    );

                    break;


                case "telemetry":

                    handleTelemetry(
                        message
                    );

                    break;
            }
        };


    socket.onclose =
        function ()
        {
            setConnectionStatus(
                "Disconnected",
                "disconnected"
            );


            clearTimeout(
                reconnectTimer
            );


            reconnectTimer =
                setTimeout(
                    connectWebSocket,
                    3000
                );
        };


    socket.onerror =
        function (error)
        {
            console.error(
                "WebSocket error:",
                error
            );
        };
}



// ============================================================
// Dashboard
// ============================================================

function updateDashboard(
    data,
    displayTimestamp = null
)
{
    document.getElementById(
        "rawTelemetry"
    ).textContent =
        JSON.stringify(
            data,
            null,
            2
        );


    document.getElementById(
        "frameNumber"
    ).textContent =
        data.frameNumber
        ??
        "--";


    document.getElementById(
        "speed"
    ).textContent =
        data.speed !== undefined
            ? Number(
                data.speed
            ).toFixed(1)
            : "--";


    if (
        data.location &&
        data.location.latitude !== undefined &&
        data.location.longitude !== undefined
    )
    {
        const latitude =
            Number(
                data.location.latitude
            );


        const longitude =
            Number(
                data.location.longitude
            );


        document.getElementById(
            "latitude"
        ).textContent =
            latitude.toFixed(
                6
            );


        document.getElementById(
            "longitude"
        ).textContent =
            longitude.toFixed(
                6
            );


        if (!vehicleMarker)
        {
            vehicleMarker =
                L.marker(
                    [
                        latitude,
                        longitude
                    ]
                ).addTo(
                    map
                );
        }
        else
        {
            vehicleMarker.setLatLng(
                [
                    latitude,
                    longitude
                ]
            );
        }


        if (firstPosition)
        {
            map.setView(
                [
                    latitude,
                    longitude
                ],
                15
            );


            firstPosition =
                false;
        }
    }


    updateDetectedObjects(
        data.detectedObjects
        ??
        []
    );


    const timestamp =
        displayTimestamp
        ??
        Date.now();


    document.getElementById(
        "lastUpdate"
    ).textContent =
        new Date(
            timestamp
        ).toLocaleTimeString();
}



// ============================================================
// Objects
// ============================================================

function updateDetectedObjects(
    objects
)
{
    const list =
        document.getElementById(
            "objectList"
        );


    list.innerHTML =
        "";


    document.getElementById(
        "objectCount"
    ).textContent =
        objects.length;


    document.getElementById(
        "objectPanelCount"
    ).textContent =
        objects.length;


    if (
        objects.length === 0
    )
    {
        const empty =
            document.createElement(
                "div"
            );


        empty.className =
            "no-objects";


        empty.textContent =
            "No objects detected";


        list.appendChild(
            empty
        );


        return;
    }


    objects.forEach(
        object =>
        {
            const item =
                document.createElement(
                    "div"
                );


            item.className =
                "object-item";


            const header =
                document.createElement(
                    "div"
                );


            header.className =
                "object-item-header";


            const type =
                document.createElement(
                    "span"
                );


            type.className =
                "object-type";


            type.textContent =
                object.type
                ??
                "unknown";


            const id =
                document.createElement(
                    "span"
                );


            id.className =
                "object-id";


            id.textContent =
                `ID ${object.id ?? "--"}`;


            header.appendChild(
                type
            );


            header.appendChild(
                id
            );


            item.appendChild(
                header
            );


            const coordinates =
                document.createElement(
                    "div"
                );


            coordinates.className =
                "object-coordinates";


            coordinates.appendChild(
                createCoordinate(
                    "X",
                    object.x
                )
            );


            coordinates.appendChild(
                createCoordinate(
                    "Y",
                    object.y
                )
            );


            coordinates.appendChild(
                createCoordinate(
                    "Width",
                    object.width
                )
            );


            coordinates.appendChild(
                createCoordinate(
                    "Height",
                    object.height
                )
            );


            item.appendChild(
                coordinates
            );


            list.appendChild(
                item
            );
        }
    );
}



function createCoordinate(
    label,
    value
)
{
    const div =
        document.createElement(
            "div"
        );


    const labelElement =
        document.createElement(
            "span"
        );


    labelElement.className =
        "coordinate-label";


    labelElement.textContent =
        `${label}: `;


    div.appendChild(
        labelElement
    );


    div.appendChild(
        document.createTextNode(
            value
            ??
            "--"
        )
    );


    return div;
}



// ============================================================
// Clear Dashboard
// ============================================================

function clearDashboard()
{
    document.getElementById(
        "frameNumber"
    ).textContent =
        "--";


    document.getElementById(
        "speed"
    ).textContent =
        "--";


    document.getElementById(
        "latitude"
    ).textContent =
        "--";


    document.getElementById(
        "longitude"
    ).textContent =
        "--";


    document.getElementById(
        "lastUpdate"
    ).textContent =
        "--";


    document.getElementById(
        "rawTelemetry"
    ).textContent =
        "Waiting for telemetry...";


    updateDetectedObjects(
        []
    );


    /*
     * Don't leave the previous selected vehicle's marker
     * visible when the newly selected vehicle has no position.
     */

    if (vehicleMarker)
    {
        map.removeLayer(
            vehicleMarker
        );


        vehicleMarker =
            null;
    }
}





// ============================================================
// Recording File UI
// ============================================================

async function refreshRecordingList()
{
    recordingSelect.innerHTML =
        "";

    const option =
        document.createElement(
            "option"
        );

    if (replayFile)
    {
        option.value =
            "open";

        option.textContent =
            `${replayFile.name} - ${replayFrameCount} msgs`;

        loadReplayButton.disabled =
            false;

        deleteRecordingButton.disabled =
            false;

        replayLastButton.disabled =
            false;
    }
    else
    {
        option.value =
            "";

        option.textContent =
            "No recording opened";

        loadReplayButton.disabled =
            true;

        deleteRecordingButton.disabled =
            true;

        replayLastButton.disabled =
            true;
    }

    recordingSelect.appendChild(
        option
    );

    /*
     * This button is now "Open Recording".
     */
    saveRecordingButton.disabled =
        false;
}


// ============================================================
// Open JSONL Recording
// ============================================================

function openRecordingFile()
{
    recordingFileInput.value =
        "";

    recordingFileInput.click();
}


async function handleRecordingFileSelected()
{
    const file =
        recordingFileInput.files?.[0];

    if (!file)
    {
        return;
    }

    await loadJsonlRecording(
        file,
        null
    );
}


async function loadJsonlRecording(
    file,
    fileHandle
)
{
    pauseReplay();

    document.getElementById(
        "replayStatus"
    ).textContent =
        "Indexing recording...";

    const index =
        [];

    let header =
        null;

    let footer =
        null;

    const CHUNK_SIZE =
        1024 * 1024;

    let carry =
        new Uint8Array(
            0
        );

    let carryStart =
        0;

    const decoder =
        new TextDecoder();

    for (
        let chunkStart = 0;
        chunkStart < file.size;
        chunkStart += CHUNK_SIZE
    )
    {
        const chunk =
            new Uint8Array(
                await file
                    .slice(
                        chunkStart,
                        Math.min(
                            file.size,
                            chunkStart + CHUNK_SIZE
                        )
                    )
                    .arrayBuffer()
            );

        const combined =
            new Uint8Array(
                carry.length +
                chunk.length
            );

        combined.set(
            carry,
            0
        );

        combined.set(
            chunk,
            carry.length
        );

        const combinedStart =
            carry.length > 0
                ? carryStart
                : chunkStart;

        let lineStart =
            0;

        for (
            let i = 0;
            i < combined.length;
            ++i
        )
        {
            if (
                combined[i] !==
                10
            )
            {
                continue;
            }

            let lineEnd =
                i;

            if (
                lineEnd > lineStart &&
                combined[lineEnd - 1] === 13
            )
            {
                --lineEnd;
            }

            const absoluteStart =
                combinedStart +
                lineStart;

            const absoluteEnd =
                combinedStart +
                i +
                1;

            if (
                lineEnd >
                lineStart
            )
            {
                const lineText =
                    decoder.decode(
                        combined.subarray(
                            lineStart,
                            lineEnd
                        )
                    );

                let record;

                try
                {
                    record =
                        JSON.parse(
                            lineText
                        );
                }
                catch (error)
                {
                    throw new Error(
                        `Invalid JSONL record near byte ${absoluteStart}: ${error.message}`
                    );
                }

                if (
                    record.recordType ===
                    "header"
                )
                {
                    header =
                        record;
                }
                else if (
                    record.recordType ===
                    "telemetry"
                )
                {
                    index.push(
                        {
                            start:
                                absoluteStart,

                            end:
                                absoluteEnd,

                            receivedAt:
                                Number(
                                    record.receivedAt
                                )
                        }
                    );
                }
                else if (
                    record.recordType ===
                    "footer"
                )
                {
                    footer =
                        record;
                }
            }

            lineStart =
                i + 1;
        }

        carry =
            combined.slice(
                lineStart
            );

        carryStart =
            combinedStart +
            lineStart;

        document.getElementById(
            "replayStatus"
        ).textContent =
            `Indexing recording... ${Math.min(
                100,
                Math.floor(
                    (
                        Math.min(
                            file.size,
                            chunkStart + CHUNK_SIZE
                        )
                        /
                        Math.max(
                            1,
                            file.size
                        )
                    )
                    *
                    100
                )
            )}%`;
    }

    /*
     * Accept a final valid JSONL line even if the file does not end
     * in '\n'. This is useful for an interrupted recording.
     */
    if (
        carry.length > 0
    )
    {
        const lineText =
            decoder.decode(
                carry
            ).trim();

        if (lineText)
        {
            try
            {
                const record =
                    JSON.parse(
                        lineText
                    );

                if (
                    record.recordType ===
                    "telemetry"
                )
                {
                    index.push(
                        {
                            start:
                                carryStart,

                            end:
                                file.size,

                            receivedAt:
                                Number(
                                    record.receivedAt
                                )
                        }
                    );
                }
                else if (
                    record.recordType ===
                    "footer"
                )
                {
                    footer =
                        record;
                }
                else if (
                    record.recordType ===
                    "header"
                )
                {
                    header =
                        record;
                }
            }
            catch
            {
                /*
                 * An interrupted final partial line is ignored.
                 * Every earlier complete line remains replayable.
                 */
            }
        }
    }

    if (!header)
    {
        throw new Error(
            "Recording header not found"
        );
    }

    if (
        index.length ===
        0
    )
    {
        throw new Error(
            "Recording contains no telemetry messages"
        );
    }

    replayFile =
        file;

    replayFileHandle =
        fileHandle;

    replayFrameIndex =
        index;

    replayHeader =
        header;

    replayRecordingId =
        file.name;

    replayVehicleId =
        header.vehicleId
        ??
        "recorded_vehicle";

    replayFrameCount =
        index.length;

    replayIndex =
        0;

    lastRecordingAvailable =
        true;

    /*
     * Add the recorded vehicle to the existing sidebar if it is not
     * currently connected. This preserves the original dashboard UX.
     */
    if (
        !vehicles.has(
            replayVehicleId
        )
    )
    {
        vehicles.set(
            replayVehicleId,
            {
                vehicleId:
                    replayVehicleId,

                vehicleName:
                    header.vehicleName
                    ??
                    replayVehicleId,

                connected:
                    false,

                lastUpdate:
                    null,

                telemetry:
                    null
            }
        );
    }

    selectedVehicleId =
        replayVehicleId;

    updateVehicleList();

    await refreshRecordingList();

    replaySlider.min =
        0;

    replaySlider.max =
        Math.max(
            0,
            replayFrameCount - 1
        );

    replaySlider.value =
        0;

    replaySlider.disabled =
        false;

    playReplayButton.disabled =
        false;

    stopReplayButton.disabled =
        false;

    previousFrameButton.disabled =
        false;

    nextFrameButton.disabled =
        false;

    document.getElementById(
        "vehicleId"
    ).textContent =
        replayVehicleId;

    document.getElementById(
        "mapVehicleName"
    ).textContent =
        header.vehicleName
        ??
        replayVehicleId;

    setMode(
        true
    );

    document.getElementById(
        "replayStatus"
    ).textContent =
        `${replayVehicleId}: ${replayFrameCount} messages` +
        (
            footer
                ? ""
                : " (interrupted recording)"
        );

    firstPosition =
        true;

    await displayReplayFrame(
        0
    );
}


// ============================================================
// Read One Indexed JSONL Record
// ============================================================

async function getReplayFrame(
    index
)
{
    if (
        !replayFile ||
        index < 0 ||
        index >= replayFrameIndex.length
    )
    {
        return null;
    }

    const entry =
        replayFrameIndex[index];

    const text =
        await replayFile
            .slice(
                entry.start,
                entry.end
            )
            .text();

    const record =
        JSON.parse(
            text.trim()
        );

    return {
        receivedAt:
            record.receivedAt,

        data:
            record.data
    };
}


// ============================================================
// Replay Controls
// ============================================================

async function loadSelectedRecording()
{
    if (
        replayFile &&
        replayFrameCount > 0
    )
    {
        firstPosition =
            true;

        setMode(
            true
        );

        await displayReplayFrame(
            0
        );
    }
}


async function replayLastRecording()
{
    await loadSelectedRecording();
}


async function displayReplayFrame(
    index
)
{
    if (
        !replayFile ||
        replayFrameCount === 0
    )
    {
        return;
    }

    index =
        Math.max(
            0,
            Math.min(
                index,
                replayFrameCount - 1
            )
        );

    const frame =
        await getReplayFrame(
            index
        );

    if (!frame)
    {
        return;
    }

    replayIndex =
        index;

    updateDashboard(
        frame.data,
        frame.receivedAt
    );

    replaySlider.value =
        index;

    document.getElementById(
        "replayStatus"
    ).textContent =
        `${replayVehicleId}: ${index + 1} / ${replayFrameCount}`;
}


function playReplay()
{
    if (
        !replayFile ||
        replayFrameCount === 0
    )
    {
        return;
    }

    if (replayPlaying)
    {
        pauseReplay();

        return;
    }

    if (
        replayIndex >=
        replayFrameCount - 1
    )
    {
        replayIndex =
            0;

        displayReplayFrame(
            0
        );
    }

    replayPlaying =
        true;

    playReplayButton.textContent =
        "Pause";

    scheduleNextReplayFrame();
}


function pauseReplay()
{
    replayPlaying =
        false;

    clearTimeout(
        replayTimer
    );

    replayTimer =
        null;

    playReplayButton.textContent =
        "Play";
}


async function scheduleNextReplayFrame()
{
    if (!replayPlaying)
    {
        return;
    }

    if (
        replayIndex >=
        replayFrameCount - 1
    )
    {
        pauseReplay();

        return;
    }

    const current =
        replayFrameIndex[
            replayIndex
        ];

    const next =
        replayFrameIndex[
            replayIndex + 1
        ];

    let delay =
        next.receivedAt -
        current.receivedAt;

    if (
        !Number.isFinite(
            delay
        )
        ||
        delay < 1
    )
    {
        delay =
            1;
    }

    delay /=
        Number(
            replaySpeed.value
        );

    replayTimer =
        setTimeout(
            async function ()
            {
                if (!replayPlaying)
                {
                    return;
                }

                await displayReplayFrame(
                    replayIndex + 1
                );

                scheduleNextReplayFrame();
            },
            delay
        );
}


async function previousReplayFrame()
{
    pauseReplay();

    if (
        replayIndex > 0
    )
    {
        await displayReplayFrame(
            replayIndex - 1
        );
    }
}


async function nextReplayFrame()
{
    pauseReplay();

    if (
        replayIndex <
        replayFrameCount - 1
    )
    {
        await displayReplayFrame(
            replayIndex + 1
        );
    }
}


async function seekReplay()
{
    pauseReplay();

    await displayReplayFrame(
        Number(
            replaySlider.value
        )
    );
}


function exitReplayMode()
{
    pauseReplay();

    replayRecordingId =
        null;

    replayIndex =
        0;

    replaySlider.value =
        0;

    replaySlider.disabled =
        true;

    playReplayButton.disabled =
        true;

    stopReplayButton.disabled =
        true;

    previousFrameButton.disabled =
        true;

    nextFrameButton.disabled =
        true;

    document.getElementById(
        "replayStatus"
    ).textContent =
        replayFile
            ? `${replayFile.name} ready`
            : "No recording loaded";

    setMode(
        false
    );

    if (selectedVehicleId)
    {
        const vehicle =
            vehicles.get(
                selectedVehicleId
            );

        if (
            vehicle &&
            vehicle.telemetry
        )
        {
            firstPosition =
                true;

            document.getElementById(
                "vehicleId"
            ).textContent =
                vehicle.vehicleId;

            document.getElementById(
                "mapVehicleName"
            ).textContent =
                vehicle.vehicleName;

            updateDashboard(
                vehicle.telemetry
            );
        }
    }
}


// ============================================================
// Mode / Connection Status
// ============================================================

function setMode(
    replay
)
{
    const element =
        document.getElementById(
            "modeStatus"
        );

    if (replay)
    {
        element.textContent =
            "REPLAY";

        element.className =
            "mode replay-mode";
    }
    else
    {
        element.textContent =
            "LIVE";

        element.className =
            "mode live-mode";
    }
}


function setConnectionStatus(
    text,
    className
)
{
    const element =
        document.getElementById(
            "connectionStatus"
        );

    element.textContent =
        text;

    element.className =
        `status ${className}`;
}


// ============================================================
// Clear Open Recording
// ============================================================

async function deleteSelectedRecording()
{
    if (!replayFile)
    {
        return;
    }

    exitReplayMode();

    replayFile =
        null;

    replayFileHandle =
        null;

    replayFrameIndex =
        [];

    replayHeader =
        null;

    replayVehicleId =
        null;

    replayFrameCount =
        0;

    lastRecordingAvailable =
        false;

    await refreshRecordingList();
}


function recordingSelectionChanged()
{
    loadReplayButton.disabled =
        !replayFile;

    deleteRecordingButton.disabled =
        !replayFile;
}


// ============================================================
// Event Listeners
// ============================================================

startRecordingButton.addEventListener(
    "click",
    startRecording
);


stopRecordingButton.addEventListener(
    "click",
    stopRecording
);


saveRecordingButton.addEventListener(
    "click",
    openRecordingFile
);


recordingFileInput.addEventListener(
    "change",
    handleRecordingFileSelected
);


deleteRecordingButton.addEventListener(
    "click",
    deleteSelectedRecording
);


recordingSelect.addEventListener(
    "change",
    recordingSelectionChanged
);


replayLastButton.addEventListener(
    "click",
    replayLastRecording
);


loadReplayButton.addEventListener(
    "click",
    loadSelectedRecording
);


playReplayButton.addEventListener(
    "click",
    playReplay
);


stopReplayButton.addEventListener(
    "click",
    exitReplayMode
);


previousFrameButton.addEventListener(
    "click",
    previousReplayFrame
);


nextFrameButton.addEventListener(
    "click",
    nextReplayFrame
);


replaySlider.addEventListener(
    "input",
    seekReplay
);



// ============================================================
// Sidebar Last-Seen Refresh
// ============================================================

setInterval(
    updateVehicleList,
    1000
);



// ============================================================
// Page Close Warning
// ============================================================

window.addEventListener(
    "beforeunload",
    function (event)
    {
        if (!isRecording)
        {
            return;
        }

        /*
         * Completed 5-second batches have already been committed.
         * The current in-RAM partial batch cannot be guaranteed to
         * finish asynchronously during browser shutdown.
         */
        event.preventDefault();

        event.returnValue =
            "";
    }
);


// ============================================================
// Initialize
// ============================================================

async function initializeApplication()
{
    await refreshRecordingList();

    connectWebSocket();
}


// ============================================================
// Start
// ============================================================

initializeApplication();

