// ============================================================
// WebSocket
// ============================================================

const wsProtocol =
    window.location.protocol === "https:"
        ? "wss:"
        : "ws:";


const WEBSOCKET_URL =
    `${wsProtocol}//${window.location.host}`;


let socket =
    null;


let reconnectTimer =
    null;


let totalMessageCount =
    0;



// ============================================================
// Vehicle state
// ============================================================

const vehicles =
    new Map();


let selectedVehicleId =
    null;



// ============================================================
// IndexedDB
// ============================================================

const DB_NAME =
    "VehicleTelemetryDB";


const DB_VERSION =
    1;


const RECORDINGS_STORE =
    "recordings";


const FRAMES_STORE =
    "frames";


let database =
    null;



// ============================================================
// Recording
// ============================================================

let isRecording =
    false;


let currentRecordingId =
    null;


let recordingVehicleId =
    null;


let currentRecordingFrameCount =
    0;



// ============================================================
// Replay
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



// ============================================================
// Map
// ============================================================

const map =
    L.map(
        "map"
    ).setView(
        [54.7, -6.2],
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
// IndexedDB
// ============================================================

function openDatabase()
{

    return new Promise(
        (resolve, reject) =>
        {

            const request =
                indexedDB.open(
                    DB_NAME,
                    DB_VERSION
                );


            request.onupgradeneeded =
                function (event)
                {

                    const db =
                        event.target.result;


                    // ========================================
                    // Recordings
                    // ========================================

                    if (
                        !db.objectStoreNames.contains(
                            RECORDINGS_STORE
                        )
                    )
                    {

                        const store =
                            db.createObjectStore(
                                RECORDINGS_STORE,
                                {

                                    keyPath:
                                        "id",

                                    autoIncrement:
                                        true

                                }
                            );


                        store.createIndex(
                            "vehicleId",
                            "vehicleId",
                            {
                                unique:
                                    false
                            }
                        );

                    }


                    // ========================================
                    // Frames
                    // ========================================

                    if (
                        !db.objectStoreNames.contains(
                            FRAMES_STORE
                        )
                    )
                    {

                        const store =
                            db.createObjectStore(
                                FRAMES_STORE,
                                {

                                    keyPath:
                                        "id",

                                    autoIncrement:
                                        true

                                }
                            );


                        store.createIndex(
                            "recordingId",
                            "recordingId",
                            {
                                unique:
                                    false
                            }
                        );


                        store.createIndex(
                            "recordingFrame",
                            [
                                "recordingId",
                                "frameIndex"
                            ],
                            {
                                unique:
                                    true
                            }
                        );

                    }

                };


            request.onsuccess =
                function ()
                {

                    database =
                        request.result;


                    resolve(
                        database
                    );

                };


            request.onerror =
                function ()
                {

                    reject(
                        request.error
                    );

                };

        }
    );

}



// ============================================================
// Create recording
// ============================================================

function createRecording(
    vehicleId,
    vehicleName
)
{

    return new Promise(
        (resolve, reject) =>
        {

            const transaction =
                database.transaction(
                    RECORDINGS_STORE,
                    "readwrite"
                );


            const store =
                transaction.objectStore(
                    RECORDINGS_STORE
                );


            const request =
                store.add({

                    vehicleId:
                        vehicleId,

                    vehicleName:
                        vehicleName,

                    startedAt:
                        new Date().toISOString(),

                    stoppedAt:
                        null,

                    frameCount:
                        0

                });


            request.onsuccess =
                () =>
                    resolve(
                        request.result
                    );


            request.onerror =
                () =>
                    reject(
                        request.error
                    );

        }
    );

}



// ============================================================
// Store frame
// ============================================================

function storeFrame(
    recordingId,
    frameIndex,
    receivedAt,
    telemetry
)
{

    return new Promise(
        (resolve, reject) =>
        {

            const transaction =
                database.transaction(
                    FRAMES_STORE,
                    "readwrite"
                );


            const store =
                transaction.objectStore(
                    FRAMES_STORE
                );


            const request =
                store.add({

                    recordingId:
                        recordingId,

                    frameIndex:
                        frameIndex,

                    receivedAt:
                        receivedAt,

                    data:
                        telemetry

                });


            request.onsuccess =
                () => resolve();


            request.onerror =
                () =>
                    reject(
                        request.error
                    );

        }
    );

}



// ============================================================
// Finish recording
// ============================================================

function finishRecording(
    recordingId,
    frameCount
)
{

    return new Promise(
        (resolve, reject) =>
        {

            const transaction =
                database.transaction(
                    RECORDINGS_STORE,
                    "readwrite"
                );


            const store =
                transaction.objectStore(
                    RECORDINGS_STORE
                );


            const request =
                store.get(
                    recordingId
                );


            request.onsuccess =
                function ()
                {

                    const recording =
                        request.result;


                    if (!recording)
                    {

                        reject(
                            new Error(
                                "Recording not found"
                            )
                        );

                        return;
                    }


                    recording.stoppedAt =
                        new Date().toISOString();


                    recording.frameCount =
                        frameCount;


                    const putRequest =
                        store.put(
                            recording
                        );


                    putRequest.onsuccess =
                        () => resolve();


                    putRequest.onerror =
                        () =>
                            reject(
                                putRequest.error
                            );

                };


            request.onerror =
                () =>
                    reject(
                        request.error
                    );

        }
    );

}



// ============================================================
// Get recordings for vehicle
// ============================================================

function getRecordingsForVehicle(
    vehicleId
)
{

    return new Promise(
        (resolve, reject) =>
        {

            const transaction =
                database.transaction(
                    RECORDINGS_STORE,
                    "readonly"
                );


            const store =
                transaction.objectStore(
                    RECORDINGS_STORE
                );


            /*
             * getAll() is deliberately used here rather than
             * depending on the vehicleId index.
             *
             * This also works if the database was created by
             * the earlier version of the dashboard.
             */

            const request =
                store.getAll();


            request.onsuccess =
                function ()
                {

                    const recordings =
                        request.result.filter(
                            recording =>
                                recording.vehicleId ===
                                vehicleId
                        );


                    resolve(
                        recordings
                    );

                };


            request.onerror =
                () =>
                    reject(
                        request.error
                    );

        }
    );

}



// ============================================================
// Get recording
// ============================================================

function getRecording(
    recordingId
)
{

    return new Promise(
        (resolve, reject) =>
        {

            const transaction =
                database.transaction(
                    RECORDINGS_STORE,
                    "readonly"
                );


            const request =
                transaction
                    .objectStore(
                        RECORDINGS_STORE
                    )
                    .get(
                        recordingId
                    );


            request.onsuccess =
                () =>
                    resolve(
                        request.result
                    );


            request.onerror =
                () =>
                    reject(
                        request.error
                    );

        }
    );

}



// ============================================================
// Get frame
// ============================================================

function getFrame(
    recordingId,
    frameIndex
)
{

    return new Promise(
        (resolve, reject) =>
        {

            const transaction =
                database.transaction(
                    FRAMES_STORE,
                    "readonly"
                );


            const index =
                transaction
                    .objectStore(
                        FRAMES_STORE
                    )
                    .index(
                        "recordingFrame"
                    );


            const request =
                index.get(
                    [
                        recordingId,
                        frameIndex
                    ]
                );


            request.onsuccess =
                () =>
                    resolve(
                        request.result
                    );


            request.onerror =
                () =>
                    reject(
                        request.error
                    );

        }
    );

}



// ============================================================
// Vehicle list
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

                vehicle = {

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


    // Anything not returned by server is offline

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


    // Auto-select first connected vehicle

    if (
        selectedVehicleId === null
    )
    {

        const first =
            serverVehicles[0];


        if (first)
        {

            selectVehicle(
                first.vehicleId
            );

        }

    }


    updateVehicleList();

}



// ============================================================
// Vehicle connected
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

        vehicle = {

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
// Vehicle disconnected
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
// Telemetry
// ============================================================

async function handleTelemetry(
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

        vehicle = {

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
    // Recording
    //
    // ONLY record telemetry belonging to the vehicle that
    // was selected when recording started.
    // ========================================================

    if (
        isRecording &&
        vehicleId === recordingVehicleId
    )
    {

        const frameIndex =
            currentRecordingFrameCount++;


        try
        {

            await storeFrame(
                currentRecordingId,
                frameIndex,
                message.serverReceivedAt
                    ?? Date.now(),
                message.data
            );


            document.getElementById(
                "recordingStatus"
            ).textContent =

                `Recording ${recordingVehicleId} - ` +
                `${currentRecordingFrameCount} frames`;

        }
        catch (error)
        {

            console.error(
                "Unable to store frame:",
                error
            );

        }

    }



    // ========================================================
    // Display only selected vehicle
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
// Draw vehicle list
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

            const item =
                document.createElement(
                    "div"
                );


            item.className =
                "vehicle-item";


            if (
                vehicle.vehicleId ===
                selectedVehicleId
            )
            {

                item.classList.add(
                    "selected"
                );

            }


            item.addEventListener(
                "click",
                () =>
                    selectVehicle(
                        vehicle.vehicleId
                    )
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
                        )
                        /
                        1000
                    );


                text.textContent =
                    `${seconds}s ago`;

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
// Select vehicle
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


    /*
     * Do not silently move an active recording to another
     * vehicle.
     */

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
        "selectedVehicleName"
    ).textContent =
        vehicle.vehicleName;


    document.getElementById(
        "selectedVehicleId"
    ).textContent =
        vehicle.vehicleId;


    document.getElementById(
        "vehicleId"
    ).textContent =
        vehicle.vehicleId;


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
// Clear dashboard
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
        "objectCount"
    ).textContent =
        "0";


    document.getElementById(
        "objectPanelCount"
    ).textContent =
        "0";


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

}



// ============================================================
// WebSocket
// ============================================================

function connectWebSocket()
{

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

            /*
             * Browser no longer supplies a vehicleId.
             */

            socket.send(
                JSON.stringify({

                    type:
                        "handshake",

                    role:
                        "browser"

                })
            );

        };


    socket.onmessage =
        async function (
            event
        )
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
                        ?? []
                    );

                    break;


                case "vehicle_connected":

                    handleVehicleConnected(
                        message.vehicle
                    );

                    break;


                case "vehicle_disconnected":

                    handleVehicleDisconnected(
                        message.vehicleId
                    );

                    break;


                case "telemetry":

                    await handleTelemetry(
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
        function (
            error
        )
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
    data
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
        ?? "--";


    if (
        data.speed !== undefined
    )
    {

        document.getElementById(
            "speed"
        ).textContent =
            Number(
                data.speed
            ).toFixed(1);

    }


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
            latitude.toFixed(6);


        document.getElementById(
            "longitude"
        ).textContent =
            longitude.toFixed(6);


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
    );


    document.getElementById(
        "lastUpdate"
    ).textContent =
        new Date()
            .toLocaleTimeString();

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


    if (
        !Array.isArray(objects) ||
        objects.length === 0
    )
    {

        document.getElementById(
            "objectCount"
        ).textContent =
            "0";


        document.getElementById(
            "objectPanelCount"
        ).textContent =
            "0";


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


    document.getElementById(
        "objectCount"
    ).textContent =
        objects.length;


    document.getElementById(
        "objectPanelCount"
    ).textContent =
        objects.length;


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
                ?? "unknown";


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



// ============================================================
// Coordinate
// ============================================================

function createCoordinate(
    label,
    value
)
{

    const div =
        document.createElement(
            "div"
        );


    const span =
        document.createElement(
            "span"
        );


    span.className =
        "coordinate-label";


    span.textContent =
        `${label}: `;


    div.appendChild(
        span
    );


    div.appendChild(
        document.createTextNode(
            value ?? "--"
        )
    );


    return div;

}



// ============================================================
// Recording
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


    exitReplayMode();


    const vehicle =
        vehicles.get(
            selectedVehicleId
        );


    currentRecordingId =
        await createRecording(
            selectedVehicleId,
            vehicle?.vehicleName
            ?? selectedVehicleId
        );


    recordingVehicleId =
        selectedVehicleId;


    currentRecordingFrameCount =
        0;


    isRecording =
        true;


    startRecordingButton.disabled =
        true;


    stopRecordingButton.disabled =
        false;


    document.getElementById(
        "recordingStatus"
    ).textContent =
        `Recording ${recordingVehicleId} - 0 frames`;

}



// ============================================================
// Stop recording
// ============================================================

async function stopRecording()
{

    if (!isRecording)
    {

        return;
    }


    /*
     * Set false first so no new telemetry is accepted into
     * this recording while it is being closed.
     */

    isRecording =
        false;


    const finishedRecordingId =
        currentRecordingId;


    const finishedVehicleId =
        recordingVehicleId;


    await finishRecording(
        finishedRecordingId,
        currentRecordingFrameCount
    );


    document.getElementById(
        "recordingStatus"
    ).textContent =

        `${finishedVehicleId}: ` +
        `${currentRecordingFrameCount} frames recorded`;


    currentRecordingId =
        null;


    recordingVehicleId =
        null;


    startRecordingButton.disabled =
        selectedVehicleId === null;


    stopRecordingButton.disabled =
        true;


    await refreshRecordingList();

}



// ============================================================
// Refresh recordings
// ============================================================

async function refreshRecordingList()
{

    recordingSelect.innerHTML =
        "";


    if (!selectedVehicleId)
    {

        const option =
            document.createElement(
                "option"
            );


        option.value =
            "";


        option.textContent =
            "No vehicle selected";


        recordingSelect.appendChild(
            option
        );


        return;
    }


    const recordings =
        await getRecordingsForVehicle(
            selectedVehicleId
        );


    recordings.sort(
        (a, b) =>
            b.id - a.id
    );


    if (
        recordings.length === 0
    )
    {

        const option =
            document.createElement(
                "option"
            );


        option.value =
            "";


        option.textContent =
            "No recordings";


        recordingSelect.appendChild(
            option
        );


        loadReplayButton.disabled =
            true;


        saveRecordingButton.disabled =
            true;


        deleteRecordingButton.disabled =
            true;


        return;
    }


    recordings.forEach(
        recording =>
        {

            const option =
                document.createElement(
                    "option"
                );


            option.value =
                recording.id;


            option.textContent =

                `#${recording.id} - ` +
                `${new Date(recording.startedAt).toLocaleString()} - ` +
                `${recording.frameCount} frames`;


            recordingSelect.appendChild(
                option
            );

        }
    );


    loadReplayButton.disabled =
        false;


    saveRecordingButton.disabled =
        false;


    deleteRecordingButton.disabled =
        false;

}



// ============================================================
// Replay
// ============================================================

async function loadSelectedRecording()
{

    const id =
        Number(
            recordingSelect.value
        );


    if (!id)
    {

        return;
    }


    const recording =
        await getRecording(
            id
        );


    if (!recording)
    {

        return;
    }


    replayRecordingId =
        id;


    replayVehicleId =
        recording.vehicleId;


    replayFrameCount =
        recording.frameCount;


    replayIndex =
        0;


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


    setMode(
        true
    );


    await displayReplayFrame(
        0
    );

}



// ============================================================
// Display replay frame
// ============================================================

async function displayReplayFrame(
    index
)
{

    if (
        replayRecordingId === null
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
        await getFrame(
            replayRecordingId,
            index
        );


    if (!frame)
    {

        return;
    }


    replayIndex =
        index;


    updateDashboard(
        frame.data
    );


    replaySlider.value =
        index;


    document.getElementById(
        "replayStatus"
    ).textContent =

        `${replayVehicleId}: ` +
        `${index + 1} / ${replayFrameCount} ` +
        `(frame ${frame.data.frameNumber ?? "--"})`;

}



// ============================================================
// Play / Pause
// ============================================================

function playReplay()
{

    if (
        replayRecordingId === null
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



// ============================================================
// Replay timing
// ============================================================

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
        await getFrame(
            replayRecordingId,
            replayIndex
        );


    const next =
        await getFrame(
            replayRecordingId,
            replayIndex + 1
        );


    if (
        !current ||
        !next
    )
    {

        pauseReplay();

        return;
    }


    let delay =
        next.receivedAt -
        current.receivedAt;


    if (
        !Number.isFinite(delay) ||
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
            async () =>
            {

                await displayReplayFrame(
                    replayIndex + 1
                );


                scheduleNextReplayFrame();

            },
            delay
        );

}



// ============================================================
// Replay navigation
// ============================================================

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



// ============================================================
// Exit replay
// ============================================================

function exitReplayMode()
{

    pauseReplay();


    replayRecordingId =
        null;


    replayVehicleId =
        null;


    replayFrameCount =
        0;


    replayIndex =
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
        "No recording loaded";


    setMode(
        false
    );


    /*
     * Immediately restore latest live telemetry.
     */

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

            updateDashboard(
                vehicle.telemetry
            );

        }

    }

}



// ============================================================
// Mode
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



// ============================================================
// Status
// ============================================================

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
// Export recording
// ============================================================

async function exportSelectedRecording()
{

    const recordingId =
        Number(
            recordingSelect.value
        );


    if (!recordingId)
    {

        return;
    }


    const recording =
        await getRecording(
            recordingId
        );


    const frames =
        [];


    for (
        let i = 0;
        i < recording.frameCount;
        i++
    )
    {

        const frame =
            await getFrame(
                recordingId,
                i
            );


        if (frame)
        {

            frames.push({

                receivedAt:
                    frame.receivedAt,

                data:
                    frame.data

            });

        }

    }


    const output = {

        formatVersion:
            2,

        vehicleId:
            recording.vehicleId,

        vehicleName:
            recording.vehicleName,

        recordingStarted:
            recording.startedAt,

        recordingStopped:
            recording.stoppedAt,

        frameCount:
            frames.length,

        frames:
            frames

    };


    const blob =
        new Blob(
            [
                JSON.stringify(
                    output,
                    null,
                    2
                )
            ],
            {
                type:
                    "application/json"
            }
        );


    const url =
        URL.createObjectURL(
            blob
        );


    const link =
        document.createElement(
            "a"
        );


    link.href =
        url;


    link.download =

        `${recording.vehicleId}_` +
        `${recording.startedAt.replaceAll(":", "-")}.json`;


    document.body.appendChild(
        link
    );


    link.click();


    link.remove();


    URL.revokeObjectURL(
        url
    );

}



// ============================================================
// Delete recording
// ============================================================

async function deleteSelectedRecording()
{

    const recordingId =
        Number(
            recordingSelect.value
        );


    if (!recordingId)
    {

        return;
    }


    if (
        !confirm(
            `Delete recording #${recordingId}?`
        )
    )
    {

        return;
    }


    if (
        replayRecordingId ===
        recordingId
    )
    {

        exitReplayMode();

    }


    const transaction =
        database.transaction(
            [
                RECORDINGS_STORE,
                FRAMES_STORE
            ],
            "readwrite"
        );


    transaction
        .objectStore(
            RECORDINGS_STORE
        )
        .delete(
            recordingId
        );


    const frameStore =
        transaction.objectStore(
            FRAMES_STORE
        );


    const index =
        frameStore.index(
            "recordingId"
        );


    const request =
        index.openCursor(
            IDBKeyRange.only(
                recordingId
            )
        );


    request.onsuccess =
        function (event)
        {

            const cursor =
                event.target.result;


            if (cursor)
            {

                cursor.delete();

                cursor.continue();

            }

        };


    transaction.oncomplete =
        async function ()
        {

            await refreshRecordingList();

        };

}



// ============================================================
// Events
// ============================================================

startRecordingButton.addEventListener(
    "click",
    startRecording
);


stopRecordingButton.addEventListener(
    "click",
    stopRecording
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


saveRecordingButton.addEventListener(
    "click",
    exportSelectedRecording
);


deleteRecordingButton.addEventListener(
    "click",
    deleteSelectedRecording
);



// ============================================================
// Periodically update "Xs ago"
// ============================================================

setInterval(
    updateVehicleList,
    1000
);



// ============================================================
// Start application
// ============================================================

async function initializeApplication()
{

    try
    {

        await openDatabase();


        connectWebSocket();

    }
    catch (error)
    {

        console.error(
            "Initialization failed:",
            error
        );


        alert(
            "Unable to initialize IndexedDB"
        );

    }

}


initializeApplication();
