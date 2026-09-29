// ============================================================
// WebSocket Configuration
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
// Vehicle State
// ============================================================

/*
 * vehicleId ->
 *
 * {
 *     vehicleId,
 *     vehicleName,
 *     connected,
 *     lastUpdate,
 *     telemetry
 * }
 */

const vehicles =
    new Map();


let selectedVehicleId =
    null;



// ============================================================
// IndexedDB Configuration
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
// Recording State
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
// Replay State
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
// UI References
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
// Open IndexedDB
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


            // =================================================
            // Database Upgrade
            // =================================================

            request.onupgradeneeded =
                function (event)
                {

                    const db =
                        event.target.result;


                    // =========================================
                    // Recordings Store
                    // =========================================

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


                    // =========================================
                    // Frames Store
                    // =========================================

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


            // =================================================
            // Open Success
            // =================================================

            request.onsuccess =
                function ()
                {

                    database =
                        request.result;


                    console.log(
                        "IndexedDB opened"
                    );


                    resolve(
                        database
                    );

                };


            // =================================================
            // Open Error
            // =================================================

            request.onerror =
                function ()
                {

                    console.error(
                        "IndexedDB error:",
                        request.error
                    );


                    reject(
                        request.error
                    );

                };

        }
    );

}



// ============================================================
// Create Recording
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
                store.add(
                    {

                        vehicleId:
                            vehicleId,

                        vehicleName:
                            vehicleName,

                        startedAt:
                            new Date()
                                .toISOString(),

                        stoppedAt:
                            null,

                        frameCount:
                            0

                    }
                );


            request.onsuccess =
                function ()
                {

                    resolve(
                        request.result
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
// Store Telemetry Frame
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
                store.add(
                    {

                        recordingId:
                            recordingId,

                        frameIndex:
                            frameIndex,

                        receivedAt:
                            receivedAt,

                        data:
                            telemetry

                    }
                );


            request.onsuccess =
                function ()
                {

                    resolve();

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
// Finish Recording
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
                        new Date()
                            .toISOString();


                    recording.frameCount =
                        frameCount;


                    const putRequest =
                        store.put(
                            recording
                        );


                    putRequest.onsuccess =
                        function ()
                        {

                            resolve();

                        };


                    putRequest.onerror =
                        function ()
                        {

                            reject(
                                putRequest.error
                            );

                        };

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
// Get Recordings For Vehicle
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
             * getAll() keeps compatibility with an IndexedDB
             * database created by the earlier dashboard.
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
// Get Recording Metadata
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

                    resolve(
                        request.result
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
// Get One Frame
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


            const store =
                transaction.objectStore(
                    FRAMES_STORE
                );


            const index =
                store.index(
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
                function ()
                {

                    resolve(
                        request.result
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
// Handle Vehicle List
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


    /*
     * Vehicles we previously knew about but that aren't in
     * the server list are shown as offline.
     */

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


    // ========================================================
    // Auto-select first connected vehicle
    // ========================================================

    if (
        selectedVehicleId === null
    )
    {

        const firstVehicle =
            serverVehicles[0];


        if (firstVehicle)
        {

            selectVehicle(
                firstVehicle.vehicleId
            );

        }

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
// Handle Telemetry
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


    // ========================================================
    // Vehicle may send telemetry before vehicle list arrives
    // ========================================================

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
    // Recording
    //
    // Only record the vehicle that was selected when the user
    // pressed Start Recording.
    // ========================================================

    if (
        isRecording &&
        vehicleId === recordingVehicleId
    )
    {

        const frameIndex =
            currentRecordingFrameCount;


        currentRecordingFrameCount++;


        try
        {

            await storeFrame(
                currentRecordingId,
                frameIndex,
                message.serverReceivedAt
                ??
                Date.now(),
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
    // Live Display
    //
    // Only selected vehicle updates the visible dashboard.
    // During replay live data continues arriving but doesn't
    // overwrite the replay display.
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


    // ========================================================
    // No vehicles
    // ========================================================

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



    // ========================================================
    // Sort Vehicles
    //
    // 1. Selected vehicle
    // 2. Connected vehicles
    // 3. Alphabetical
    // ========================================================

    const sorted =
        Array.from(
            vehicles.values()
        );


    sorted.sort(
        (a, b) =>
        {

            // Selected vehicle always first

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


            // Connected before offline

            if (
                a.connected !==
                b.connected
            )
            {

                return a.connected
                    ? -1
                    : 1;

            }


            // Alphabetical

            return a.vehicleName.localeCompare(
                b.vehicleName
            );

        }
    );



    // ========================================================
    // Create Vehicle Items
    // ========================================================

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



            // =================================================
            // Click
            // =================================================

            item.addEventListener(
                "click",
                function ()
                {

                    selectVehicle(
                        vehicle.vehicleId
                    );

                }
            );



            // =================================================
            // Vehicle Name
            // =================================================

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



            // =================================================
            // Selected Badge
            // =================================================

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



            // =================================================
            // Vehicle ID
            // =================================================

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



            // =================================================
            // Status
            // =================================================

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


            const statusText =
                document.createElement(
                    "span"
                );


            if (!vehicle.connected)
            {

                statusText.textContent =
                    "Offline";

            }
            else if (
                vehicle.lastUpdate === null
            )
            {

                statusText.textContent =
                    "Connected";

            }
            else
            {

                const elapsed =
                    Date.now() -
                    vehicle.lastUpdate;


                const seconds =
                    Math.floor(
                        elapsed / 1000
                    );


                if (
                    seconds < 60
                )
                {

                    statusText.textContent =
                        `${seconds}s ago`;

                }
                else
                {

                    const minutes =
                        Math.floor(
                            seconds / 60
                        );


                    statusText.textContent =
                        `${minutes}m ago`;

                }

            }


            status.appendChild(
                statusText
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


    // ========================================================
    // Don't silently switch an active recording
    // ========================================================

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



    // ========================================================
    // Exit Replay
    // ========================================================

    exitReplayMode();



    // ========================================================
    // Change Selection
    // ========================================================

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



    // ========================================================
    // Vehicle Information
    // ========================================================

    document.getElementById(
        "vehicleId"
    ).textContent =
        vehicle.vehicleId;


    document.getElementById(
        "mapVehicleName"
    ).textContent =
        vehicle.vehicleName;



    // ========================================================
    // Recording
    // ========================================================

    startRecordingButton.disabled =
        false;


    document.getElementById(
        "recordingStatus"
    ).textContent =
        "Not recording";



    // ========================================================
    // Show Latest Telemetry
    // ========================================================

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



    // ========================================================
    // Refresh Recordings For This Vehicle
    // ========================================================

    await refreshRecordingList();



    // ========================================================
    // Selected Vehicle Moves To Top
    // ========================================================

    updateVehicleList();

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
// Connect WebSocket
// ============================================================

function connectWebSocket()
{

    /*
     * Prevent multiple simultaneous connection attempts.
     */

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



    // ========================================================
    // Open
    // ========================================================

    socket.onopen =
        function ()
        {

            /*
             * Browser dashboard receives all vehicles.
             *
             * It therefore does NOT supply vehicleId.
             */

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



    // ========================================================
    // Incoming Message
    // ========================================================

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
            catch (error)
            {

                console.error(
                    "Invalid WebSocket JSON:",
                    error
                );


                return;

            }



            switch (
                message.type
            )
            {

                // =============================================
                // Handshake
                // =============================================

                case "handshake_ack":

                    if (
                        message.status ===
                        "ok"
                    )
                    {

                        setConnectionStatus(
                            "Connected",
                            "connected"
                        );

                    }

                    break;



                // =============================================
                // Complete Vehicle List
                // =============================================

                case "vehicle_list":

                    handleVehicleList(
                        message.vehicles
                        ??
                        []
                    );

                    break;



                // =============================================
                // Vehicle Connected
                // =============================================

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



                // =============================================
                // Vehicle Disconnected
                // =============================================

                case "vehicle_disconnected":

                    handleVehicleDisconnected(
                        message.vehicleId
                    );

                    break;



                // =============================================
                // Telemetry
                // =============================================

                case "telemetry":

                    await handleTelemetry(
                        message
                    );

                    break;


                default:

                    console.log(
                        "Unknown WebSocket message:",
                        message
                    );

                    break;

            }

        };



    // ========================================================
    // Close
    // ========================================================

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



    // ========================================================
    // Error
    // ========================================================

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
// Update Dashboard
// ============================================================

function updateDashboard(
    data
)
{

    // ========================================================
    // Raw JSON
    // ========================================================

    document.getElementById(
        "rawTelemetry"
    ).textContent =
        JSON.stringify(
            data,
            null,
            2
        );



    // ========================================================
    // Frame
    // ========================================================

    document.getElementById(
        "frameNumber"
    ).textContent =
        data.frameNumber
        ??
        "--";



    // ========================================================
    // Speed
    // ========================================================

    if (
        data.speed !== undefined &&
        data.speed !== null
    )
    {

        document.getElementById(
            "speed"
        ).textContent =
            Number(
                data.speed
            ).toFixed(
                1
            );

    }
    else
    {

        document.getElementById(
            "speed"
        ).textContent =
            "--";

    }



    // ========================================================
    // GPS
    // ========================================================

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



        // ====================================================
        // Map Marker
        // ====================================================

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



        // ====================================================
        // Re-center after selecting another vehicle
        // ====================================================

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
    else
    {

        document.getElementById(
            "latitude"
        ).textContent =
            "--";


        document.getElementById(
            "longitude"
        ).textContent =
            "--";

    }



    // ========================================================
    // Objects
    // ========================================================

    updateDetectedObjects(
        data.detectedObjects
    );



    // ========================================================
    // Last Update
    // ========================================================

    document.getElementById(
        "lastUpdate"
    ).textContent =
        new Date()
            .toLocaleTimeString();

}



// ============================================================
// Update Detected Objects
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



    // ========================================================
    // No Objects
    // ========================================================

    if (
        !Array.isArray(
            objects
        )
        ||
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



    // ========================================================
    // Object Count
    // ========================================================

    document.getElementById(
        "objectCount"
    ).textContent =
        objects.length;


    document.getElementById(
        "objectPanelCount"
    ).textContent =
        objects.length;



    // ========================================================
    // Create Object Cards
    // ========================================================

    objects.forEach(
        object =>
        {

            const item =
                document.createElement(
                    "div"
                );


            item.className =
                "object-item";



            // =================================================
            // Header
            // =================================================

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



            // =================================================
            // Bounding Box
            // =================================================

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
// Create Coordinate Element
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


    exitReplayMode();


    const vehicle =
        vehicles.get(
            selectedVehicleId
        );


    try
    {

        currentRecordingId =
            await createRecording(
                selectedVehicleId,
                vehicle?.vehicleName
                ??
                selectedVehicleId
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
    catch (error)
    {

        console.error(
            "Unable to start recording:",
            error
        );


        alert(
            "Unable to start recording."
        );

    }

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
     * Stop accepting new telemetry into the recording before
     * updating its metadata.
     */

    isRecording =
        false;


    const finishedRecordingId =
        currentRecordingId;


    const finishedVehicleId =
        recordingVehicleId;


    try
    {

        await finishRecording(
            finishedRecordingId,
            currentRecordingFrameCount
        );


        document.getElementById(
            "recordingStatus"
        ).textContent =

            `${finishedVehicleId}: ` +
            `${currentRecordingFrameCount} frames recorded`;

    }
    catch (error)
    {

        console.error(
            "Unable to finish recording:",
            error
        );

    }


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
// Refresh Recording List
// ============================================================

async function refreshRecordingList()
{

    recordingSelect.innerHTML =
        "";


    // ========================================================
    // No Vehicle
    // ========================================================

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


        loadReplayButton.disabled =
            true;


        saveRecordingButton.disabled =
            true;


        deleteRecordingButton.disabled =
            true;


        return;

    }



    // ========================================================
    // Get Recordings
    // ========================================================

    const recordings =
        await getRecordingsForVehicle(
            selectedVehicleId
        );


    recordings.sort(
        (a, b) =>
            b.id - a.id
    );



    // ========================================================
    // None
    // ========================================================

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



    // ========================================================
    // Add Recordings
    // ========================================================

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

                `${new Date(
                    recording.startedAt
                ).toLocaleString()} - ` +

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
// Load Recording
// ============================================================

async function loadSelectedRecording()
{

    const recordingId =
        Number(
            recordingSelect.value
        );


    if (!recordingId)
    {

        return;

    }


    try
    {

        const recording =
            await getRecording(
                recordingId
            );


        if (!recording)
        {

            return;

        }


        pauseReplay();


        replayRecordingId =
            recordingId;


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
            replayFrameCount === 0;


        stopReplayButton.disabled =
            false;


        previousFrameButton.disabled =
            replayFrameCount === 0;


        nextFrameButton.disabled =
            replayFrameCount === 0;


        setMode(
            true
        );


        if (
            replayFrameCount > 0
        )
        {

            await displayReplayFrame(
                0
            );

        }

    }
    catch (error)
    {

        console.error(
            "Unable to load recording:",
            error
        );

    }

}



// ============================================================
// Display Replay Frame
// ============================================================

async function displayReplayFrame(
    index
)
{

    if (
        replayRecordingId === null ||
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
        await getFrame(
            replayRecordingId,
            index
        );


    if (!frame)
    {

        console.warn(
            "Replay frame not found:",
            index
        );


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

        `(telemetry frame ` +

        `${frame.data.frameNumber ?? "--"})`;

}



// ============================================================
// Play Replay
// ============================================================

function playReplay()
{

    if (
        replayRecordingId === null ||
        replayFrameCount === 0
    )
    {

        return;

    }


    // ========================================================
    // Toggle Pause
    // ========================================================

    if (replayPlaying)
    {

        pauseReplay();

        return;

    }



    // ========================================================
    // Restart At Beginning If At End
    // ========================================================

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



// ============================================================
// Pause Replay
// ============================================================

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
// Schedule Replay Frame
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



    // ========================================================
    // Original Recording Timing
    // ========================================================

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



    // ========================================================
    // Replay Speed
    // ========================================================

    const speed =
        Number(
            replaySpeed.value
        );


    delay =
        delay / speed;



    // ========================================================
    // Schedule
    // ========================================================

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



// ============================================================
// Previous Replay Frame
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



// ============================================================
// Next Replay Frame
// ============================================================

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



// ============================================================
// Seek Replay
// ============================================================

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
// Exit Replay Mode
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
        "No recording loaded";


    setMode(
        false
    );



    // ========================================================
    // Restore latest live frame
    // ========================================================

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
// Set Mode
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
// Set Connection Status
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
// Export Selected Recording
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


    try
    {

        const recording =
            await getRecording(
                recordingId
            );


        if (!recording)
        {

            return;

        }


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

                frames.push(
                    {

                        receivedAt:
                            frame.receivedAt,

                        data:
                            frame.data

                    }
                );

            }

        }



        const output =
            {

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



        const json =
            JSON.stringify(
                output,
                null,
                2
            );


        const blob =
            new Blob(
                [
                    json
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


        const timestamp =
            recording.startedAt
                .replaceAll(
                    ":",
                    "-"
                );


        link.href =
            url;


        link.download =

            `${recording.vehicleId}_` +
            `${timestamp}.json`;


        document.body.appendChild(
            link
        );


        link.click();


        link.remove();


        URL.revokeObjectURL(
            url
        );

    }
    catch (error)
    {

        console.error(
            "Unable to export recording:",
            error
        );


        alert(
            "Unable to export recording."
        );

    }

}



// ============================================================
// Delete Selected Recording
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


    const confirmed =
        confirm(
            `Delete recording #${recordingId}?`
        );


    if (!confirmed)
    {

        return;

    }



    // ========================================================
    // Exit Replay If This Recording Is Active
    // ========================================================

    if (
        replayRecordingId ===
        recordingId
    )
    {

        exitReplayMode();

    }



    // ========================================================
    // Transaction
    // ========================================================

    const transaction =
        database.transaction(
            [
                RECORDINGS_STORE,
                FRAMES_STORE
            ],
            "readwrite"
        );



    // ========================================================
    // Delete Recording Metadata
    // ========================================================

    transaction
        .objectStore(
            RECORDINGS_STORE
        )
        .delete(
            recordingId
        );



    // ========================================================
    // Delete Recording Frames
    // ========================================================

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



    // ========================================================
    // Refresh
    // ========================================================

    transaction.oncomplete =
        async function ()
        {

            await refreshRecordingList();

        };


    transaction.onerror =
        function ()
        {

            console.error(
                "Unable to delete recording:",
                transaction.error
            );

        };

}



// ============================================================
// Recording Selection Changed
// ============================================================

function recordingSelectionChanged()
{

    const selected =
        recordingSelect.value !== "";


    loadReplayButton.disabled =
        !selected;


    saveRecordingButton.disabled =
        !selected;


    deleteRecordingButton.disabled =
        !selected;

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
    exportSelectedRecording
);


deleteRecordingButton.addEventListener(
    "click",
    deleteSelectedRecording
);


recordingSelect.addEventListener(
    "change",
    recordingSelectionChanged
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
// Update Vehicle "Last Seen" Display
// ============================================================

setInterval(
    function ()
    {

        updateVehicleList();

    },
    1000
);



// ============================================================
// Initialize Application
// ============================================================

async function initializeApplication()
{

    try
    {

        // ====================================================
        // IndexedDB
        // ====================================================

        await openDatabase();



        // ====================================================
        // WebSocket
        // ====================================================

        connectWebSocket();

    }
    catch (error)
    {

        console.error(
            "Application initialization failed:",
            error
        );


        alert(
            "Unable to initialize telemetry database."
        );

    }

}



// ============================================================
// Start
// ============================================================

initializeApplication();
