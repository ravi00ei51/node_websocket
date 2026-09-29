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
// IndexedDB
// ============================================================

const DB_NAME =
    "VehicleTelemetryDB";


/*
 * Version 2 is intentional.
 *
 * This guarantees that users who previously opened an older
 * version of the dashboard get the indexes required by the
 * new logger/replay implementation.
 */

const DB_VERSION =
    2;


const RECORDINGS_STORE =
    "recordings";


const FRAMES_STORE =
    "frames";


let database =
    null;



// ============================================================
// 5 Second Cyclic Logger
// ============================================================

const RECORDING_FLUSH_INTERVAL_MS =
    5000;


let isRecording =
    false;


let currentRecordingId =
    null;


let recordingVehicleId =
    null;


let recordingVehicleName =
    null;


/*
 * Next frame number inside the recording.
 */

let recordingFrameIndex =
    0;


/*
 * Current RAM buffer.
 *
 * ALL telemetry messages are placed here.
 */

let recordingBuffer =
    [];


/*
 * Five-second timer.
 */

let recordingFlushTimer =
    null;


/*
 * Serializes IndexedDB writes.
 *
 * If a DB write takes longer than expected, the next batch
 * waits rather than overlapping incorrectly.
 */

let recordingWriteChain =
    Promise.resolve();



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


let lastRecordingId =
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
// Open Database
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


                    // =========================================
                    // Recordings
                    // =========================================

                    let recordingStore;


                    if (
                        !db.objectStoreNames.contains(
                            RECORDINGS_STORE
                        )
                    )
                    {
                        recordingStore =
                            db.createObjectStore(
                                RECORDINGS_STORE,
                                {
                                    keyPath:
                                        "id",

                                    autoIncrement:
                                        true
                                }
                            );
                    }
                    else
                    {
                        recordingStore =
                            event.target.transaction
                                .objectStore(
                                    RECORDINGS_STORE
                                );
                    }


                    if (
                        !recordingStore.indexNames.contains(
                            "vehicleId"
                        )
                    )
                    {
                        recordingStore.createIndex(
                            "vehicleId",
                            "vehicleId",
                            {
                                unique:
                                    false
                            }
                        );
                    }


                    if (
                        !recordingStore.indexNames.contains(
                            "startedAt"
                        )
                    )
                    {
                        recordingStore.createIndex(
                            "startedAt",
                            "startedAt",
                            {
                                unique:
                                    false
                            }
                        );
                    }



                    // =========================================
                    // Frames
                    // =========================================

                    let frameStore;


                    if (
                        !db.objectStoreNames.contains(
                            FRAMES_STORE
                        )
                    )
                    {
                        frameStore =
                            db.createObjectStore(
                                FRAMES_STORE,
                                {
                                    keyPath:
                                        "id",

                                    autoIncrement:
                                        true
                                }
                            );
                    }
                    else
                    {
                        frameStore =
                            event.target.transaction
                                .objectStore(
                                    FRAMES_STORE
                                );
                    }


                    if (
                        !frameStore.indexNames.contains(
                            "recordingId"
                        )
                    )
                    {
                        frameStore.createIndex(
                            "recordingId",
                            "recordingId",
                            {
                                unique:
                                    false
                            }
                        );
                    }


                    if (
                        !frameStore.indexNames.contains(
                            "recordingFrame"
                        )
                    )
                    {
                        frameStore.createIndex(
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


            const now =
                new Date()
                    .toISOString();


            const request =
                store.add(
                    {
                        vehicleId:
                            vehicleId,

                        vehicleName:
                            vehicleName,

                        startedAt:
                            now,

                        lastStoredAt:
                            null,

                        stoppedAt:
                            null,

                        frameCount:
                            0,

                        status:
                            "recording"
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
// Store Complete 5 Second Batch
// ============================================================

function storeFrameBatch(
    recordingId,
    frames
)
{
    return new Promise(
        (resolve, reject) =>
        {
            if (
                !frames ||
                frames.length === 0
            )
            {
                resolve();

                return;
            }


            const transaction =
                database.transaction(
                    [
                        FRAMES_STORE,
                        RECORDINGS_STORE
                    ],
                    "readwrite"
                );


            const frameStore =
                transaction.objectStore(
                    FRAMES_STORE
                );


            const recordingStore =
                transaction.objectStore(
                    RECORDINGS_STORE
                );



            // ================================================
            // Write ALL telemetry messages in the batch
            // ================================================

            for (
                const frame of frames
            )
            {
                frameStore.add(
                    {
                        recordingId:
                            recordingId,

                        frameIndex:
                            frame.frameIndex,

                        receivedAt:
                            frame.receivedAt,

                        data:
                            frame.data
                    }
                );
            }



            // ================================================
            // Update Metadata
            // ================================================

            const getRequest =
                recordingStore.get(
                    recordingId
                );


            getRequest.onsuccess =
                function ()
                {
                    const recording =
                        getRequest.result;


                    if (!recording)
                    {
                        transaction.abort();

                        return;
                    }


                    const lastFrame =
                        frames[
                            frames.length - 1
                        ];


                    recording.frameCount =
                        Math.max(
                            recording.frameCount || 0,
                            lastFrame.frameIndex + 1
                        );


                    recording.lastStoredAt =
                        new Date()
                            .toISOString();


                    recordingStore.put(
                        recording
                    );
                };


            getRequest.onerror =
                function ()
                {
                    transaction.abort();
                };


            transaction.oncomplete =
                function ()
                {
                    console.log(
                        `IndexedDB batch stored: ` +
                        `${frames.length} messages`
                    );


                    resolve();
                };


            transaction.onerror =
                function ()
                {
                    reject(
                        transaction.error
                    );
                };


            transaction.onabort =
                function ()
                {
                    reject(
                        transaction.error
                        ??
                        new Error(
                            "IndexedDB transaction aborted"
                        )
                    );
                };
        }
    );
}



// ============================================================
// Flush Current RAM Buffer
// ============================================================

function flushRecordingBuffer()
{
    if (
        recordingBuffer.length === 0 ||
        currentRecordingId === null
    )
    {
        return recordingWriteChain;
    }


    /*
     * IMPORTANT:
     *
     * Swap buffers immediately.
     *
     * New WebSocket telemetry can continue entering the new
     * recordingBuffer while IndexedDB writes this old batch.
     */

    const batch =
        recordingBuffer;


    recordingBuffer =
        [];


    const recordingId =
        currentRecordingId;


    recordingWriteChain =
        recordingWriteChain
            .then(
                () =>
                    storeFrameBatch(
                        recordingId,
                        batch
                    )
            );


    /*
     * Log errors without breaking future batches.
     */

    recordingWriteChain =
        recordingWriteChain.catch(
            error =>
            {
                console.error(
                    "IndexedDB batch write failed:",
                    error
                );


                throw error;
            }
        );


    return recordingWriteChain;
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


                    recording.status =
                        "completed";


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
// Get Recording
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
// Get All Recordings
// ============================================================

function getAllRecordings()
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
                store.getAll();


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
// Recordings For Vehicle
// ============================================================

async function getRecordingsForVehicle(
    vehicleId
)
{
    const recordings =
        await getAllRecordings();


    return recordings.filter(
        recording =>
            recording.vehicleId ===
            vehicleId
    );
}



// ============================================================
// Get Frame
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
// Recover Previous Session
// ============================================================

async function recoverPreviousRecordings()
{
    const recordings =
        await getAllRecordings();


    /*
     * A recording left with status="recording" means the
     * browser was probably closed/reloaded without Stop.
     *
     * Everything through the last successful 5-second flush
     * is already safely in IndexedDB.
     */

    for (
        const recording of recordings
    )
    {
        if (
            recording.status ===
            "recording"
        )
        {
            recording.status =
                "interrupted";


            await updateRecordingMetadata(
                recording
            );
        }
    }


    await updateLastRecording();
}



// ============================================================
// Update Recording Metadata
// ============================================================

function updateRecordingMetadata(
    recording
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
                store.put(
                    recording
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
// Determine Last Recording
// ============================================================

async function updateLastRecording()
{
    const recordings =
        await getAllRecordings();


    const usable =
        recordings.filter(
            recording =>
                (recording.frameCount || 0) > 0
        );


    usable.sort(
        (a, b) =>
        {
            return (
                new Date(
                    b.startedAt
                ).getTime()
                -
                new Date(
                    a.startedAt
                ).getTime()
            );
        }
    );


    if (
        usable.length === 0
    )
    {
        lastRecordingId =
            null;


        replayLastButton.disabled =
            true;


        return;
    }


    lastRecordingId =
        usable[0].id;


    replayLastButton.disabled =
        false;
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


        recordingVehicleName =
            vehicle?.vehicleName
            ??
            selectedVehicleId;


        recordingFrameIndex =
            0;


        recordingBuffer =
            [];


        recordingWriteChain =
            Promise.resolve();


        isRecording =
            true;



        // ====================================================
        // Every 5 seconds write ALL accumulated messages.
        // ====================================================

        recordingFlushTimer =
            setInterval(
                () =>
                {
                    flushRecordingBuffer()
                        .catch(
                            error =>
                            {
                                console.error(
                                    "Periodic flush failed:",
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
     * No new telemetry enters this recording after this point.
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


    const finishedRecordingId =
        currentRecordingId;


    const finishedVehicleId =
        recordingVehicleId;


    const totalFrames =
        recordingFrameIndex;


    try
    {
        /*
         * Write the final partial interval.
         *
         * Example:
         *
         * 10 sec stored
         * Stop at 12.8 sec
         *
         * The remaining 2.8 seconds are written here.
         */

        await flushRecordingBuffer();


        /*
         * Ensure all earlier batches have completed.
         */

        await recordingWriteChain;


        await finishRecording(
            finishedRecordingId,
            totalFrames
        );


        document.getElementById(
            "recordingStatus"
        ).textContent =
            `${finishedVehicleId}: ` +
            `${totalFrames} messages recorded`;
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
            "Recording storage error";
    }


    currentRecordingId =
        null;


    recordingVehicleId =
        null;


    recordingVehicleName =
        null;


    recordingBuffer =
        [];


    recordingFrameIndex =
        0;


    startRecordingButton.disabled =
        selectedVehicleId === null;


    stopRecordingButton.disabled =
        true;


    await updateLastRecording();


    await refreshRecordingList();
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
// Recording List
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


        loadReplayButton.disabled =
            true;


        saveRecordingButton.disabled =
            true;


        deleteRecordingButton.disabled =
            true;


        return;
    }


    const recordings =
        await getRecordingsForVehicle(
            selectedVehicleId
        );


    const usable =
        recordings.filter(
            recording =>
                (recording.frameCount || 0) > 0
        );


    usable.sort(
        (a, b) =>
            new Date(
                b.startedAt
            ).getTime()
            -
            new Date(
                a.startedAt
            ).getTime()
    );


    if (
        usable.length === 0
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


    usable.forEach(
        recording =>
        {
            const option =
                document.createElement(
                    "option"
                );


            option.value =
                recording.id;


            const status =
                recording.status ===
                "interrupted"
                    ? "INTERRUPTED"
                    : "COMPLETED";


            option.textContent =
                `#${recording.id} - ` +
                `${new Date(
                    recording.startedAt
                ).toLocaleString()} - ` +
                `${recording.frameCount} msgs - ` +
                status;


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
// Load Recording By ID
// ============================================================

async function loadRecordingById(
    recordingId
)
{
    const recording =
        await getRecording(
            recordingId
        );


    if (
        !recording ||
        recording.frameCount === 0
    )
    {
        return;
    }


    pauseReplay();


    replayRecordingId =
        recording.id;


    replayVehicleId =
        recording.vehicleId;


    replayFrameCount =
        recording.frameCount;


    replayIndex =
        0;


    firstPosition =
        true;


    document.getElementById(
        "vehicleId"
    ).textContent =
        recording.vehicleId;


    document.getElementById(
        "mapVehicleName"
    ).textContent =
        recording.vehicleName
        ??
        recording.vehicleId;


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
// Load Selected Recording
// ============================================================

async function loadSelectedRecording()
{
    const id =
        Number(
            recordingSelect.value
        );


    if (id)
    {
        await loadRecordingById(
            id
        );
    }
}



// ============================================================
// Replay Last Recording
// ============================================================

async function replayLastRecording()
{
    await updateLastRecording();


    if (
        lastRecordingId !== null
    )
    {
        await loadRecordingById(
            lastRecordingId
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
        `${replayVehicleId}: ` +
        `${index + 1} / ${replayFrameCount}`;
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
// Replay Timing
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



// ============================================================
// Replay Navigation
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
// Exit Replay
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
// Connection Status
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
// Export Recording
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

            status:
                recording.status,

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
        `${recording.vehicleId}_recording_${recording.id}.json`;


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
// Delete Recording
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
            await updateLastRecording();

            await refreshRecordingList();
        };
}



// ============================================================
// Selection Changed
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
// Best-Effort Final Flush
// ============================================================

window.addEventListener(
    "pagehide",
    function ()
    {
        if (
            isRecording &&
            recordingBuffer.length > 0
        )
        {
            /*
             * This is best effort only.
             *
             * Browsers are NOT required to keep the page alive
             * long enough for an asynchronous IndexedDB
             * transaction to complete.
             *
             * The regular 5-second commits are the actual
             * persistence guarantee.
             */

            flushRecordingBuffer()
                .catch(
                    () =>
                    {
                    }
                );
        }
    }
);



// ============================================================
// Initialize
// ============================================================

async function initializeApplication()
{
    try
    {
        await openDatabase();


        /*
         * Detect recordings left behind by a previous browser
         * session.
         */

        await recoverPreviousRecordings();


        /*
         * Replay Last Recording is already available here,
         * even before a Jetson reconnects.
         */

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
