// ============================================================
// Configuration
// ============================================================

const VEHICLE_ID =
    "vehicle_001";


const wsProtocol =
    window.location.protocol === "https:"
        ? "wss:"
        : "ws:";


const WEBSOCKET_URL =
    `${wsProtocol}//${window.location.host}`;

    

// ============================================================
// WebSocket state
// ============================================================

let socket = null;

let reconnectTimer = null;

let messageCount = 0;



// ============================================================
// Recording state
// ============================================================

let isRecording = false;

let recordedFrames = [];

let recordingStarted = null;

let recordingStopped = null;



// ============================================================
// Replay state
// ============================================================

let replayRecording = null;

let replayFrames = [];

let replayIndex = 0;

let replayPlaying = false;

let replayTimer = null;



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

        maxZoom: 19,

        attribution:
            "&copy; OpenStreetMap contributors"

    }

).addTo(map);


let vehicleMarker = null;

let firstPosition = true;



// ============================================================
// UI references
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


const replayFileInput =
    document.getElementById(
        "replayFileInput"
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
// Connection status
// ============================================================

function setConnectionStatus(
    text,
    className
) {

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
// Mode
// ============================================================

function setMode(
    replay
) {

    const element =
        document.getElementById(
            "modeStatus"
        );


    if (replay) {

        element.textContent =
            "REPLAY";

        element.className =
            "mode replay-mode";

    }
    else {

        element.textContent =
            "LIVE";

        element.className =
            "mode live-mode";

    }

}



// ============================================================
// WebSocket
// ============================================================

function connectWebSocket()
{

    if (
        socket &&
        (
            socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING
        )
    ) {

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

    socket.onopen = function ()
    {

        const handshake = {

            type:
                "handshake",

            role:
                "browser",

            vehicleId:
                VEHICLE_ID

        };


        socket.send(
            JSON.stringify(
                handshake
            )
        );

    };


    // ========================================================
    // Message
    // ========================================================

    socket.onmessage = function (
        event
    )
    {

        let data;


        try {

            data =
                JSON.parse(
                    event.data
                );

        }
        catch (error) {

            console.error(
                "Invalid JSON:",
                event.data
            );

            return;
        }


        // ----------------------------------------------------
        // Handshake
        // ----------------------------------------------------

        if (
            data.type ===
            "handshake_ack"
        ) {

            if (
                data.status ===
                "ok"
            ) {

                setConnectionStatus(
                    "Connected",
                    "connected"
                );

            }


            return;
        }


        // ----------------------------------------------------
        // Live telemetry
        // ----------------------------------------------------

        messageCount++;


        document.getElementById(
            "messageCount"
        ).textContent =
            messageCount;


        // ----------------------------------------------------
        // Record telemetry
        // ----------------------------------------------------

        if (isRecording) {

            recordedFrames.push({

                receivedAt:
                    Date.now(),

                data:
                    structuredClone(
                        data
                    )

            });


            document.getElementById(
                "recordingStatus"
            ).textContent =
                `Recording - ${recordedFrames.length} frames`;

        }


        // ----------------------------------------------------
        // Don't overwrite replay display
        // ----------------------------------------------------

        if (!replayRecording) {

            updateDashboard(
                data
            );

        }

    };


    // ========================================================
    // Close
    // ========================================================

    socket.onclose = function ()
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

    socket.onerror = function (
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
        data.frameNumber ?? "--";


    // ========================================================
    // Speed
    // ========================================================

    if (
        data.speed !== undefined
    ) {

        document.getElementById(
            "speed"
        ).textContent =
            Number(
                data.speed
            ).toFixed(1);

    }


    // ========================================================
    // GPS
    // ========================================================

    if (
        data.location &&
        data.location.latitude !== undefined &&
        data.location.longitude !== undefined
    ) {

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


        // ----------------------------------------------------
        // Map marker
        // ----------------------------------------------------

        if (!vehicleMarker) {

            vehicleMarker =
                L.marker(
                    [
                        latitude,
                        longitude
                    ]
                ).addTo(
                    map
                );


            vehicleMarker.bindPopup(
                VEHICLE_ID
            );

        }
        else {

            vehicleMarker.setLatLng(
                [
                    latitude,
                    longitude
                ]
            );

        }


        if (firstPosition) {

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


    // ========================================================
    // Objects
    // ========================================================

    updateDetectedObjects(
        data.detectedObjects
    );


    // ========================================================
    // Last update
    // ========================================================

    document.getElementById(
        "lastUpdate"
    ).textContent =
        new Date()
            .toLocaleTimeString();

}



// ============================================================
// Detected Objects
// ============================================================

function updateDetectedObjects(
    objects
)
{

    const objectList =
        document.getElementById(
            "objectList"
        );


    const objectCount =
        document.getElementById(
            "objectCount"
        );


    const objectPanelCount =
        document.getElementById(
            "objectPanelCount"
        );


    objectList.innerHTML = "";


    if (
        !Array.isArray(objects) ||
        objects.length === 0
    ) {

        objectCount.textContent =
            "0";


        objectPanelCount.textContent =
            "0";


        const empty =
            document.createElement(
                "div"
            );


        empty.className =
            "no-objects";


        empty.textContent =
            "No objects detected";


        objectList.appendChild(
            empty
        );


        return;
    }


    objectCount.textContent =
        objects.length;


    objectPanelCount.textContent =
        objects.length;


    objects.forEach(
        (object) =>
        {

            const item =
                document.createElement(
                    "div"
                );


            item.className =
                "object-item";


            // ------------------------------------------------
            // Header
            // ------------------------------------------------

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
                object.type ?? "unknown";


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


            // ------------------------------------------------
            // Coordinates
            // ------------------------------------------------

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


            objectList.appendChild(
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

    const element =
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


    element.appendChild(
        labelElement
    );


    element.appendChild(
        document.createTextNode(
            value ?? "--"
        )
    );


    return element;
}



// ============================================================
// RECORDING
// ============================================================

function startRecording()
{

    // Don't allow recording while replaying

    stopReplay();


    replayRecording = null;

    setMode(false);


    recordedFrames = [];

    recordingStarted =
        new Date();

    recordingStopped =
        null;

    isRecording =
        true;


    startRecordingButton.disabled =
        true;


    stopRecordingButton.disabled =
        false;


    saveRecordingButton.disabled =
        true;


    document.getElementById(
        "recordingStatus"
    ).textContent =
        "Recording - 0 frames";

}



// ============================================================
// Stop recording
// ============================================================

function stopRecording()
{

    if (!isRecording) {

        return;
    }


    isRecording =
        false;


    recordingStopped =
        new Date();


    startRecordingButton.disabled =
        false;


    stopRecordingButton.disabled =
        true;


    saveRecordingButton.disabled =
        recordedFrames.length === 0;


    document.getElementById(
        "recordingStatus"
    ).textContent =
        `Stopped - ${recordedFrames.length} frames recorded`;

}



// ============================================================
// Save recording
// ============================================================

function saveRecording()
{

    if (
        recordedFrames.length === 0
    ) {

        return;
    }


    const recording = {

        formatVersion:
            1,

        vehicleId:
            VEHICLE_ID,

        recordingStarted:
            recordingStarted
                ? recordingStarted.toISOString()
                : null,

        recordingStopped:
            recordingStopped
                ? recordingStopped.toISOString()
                : new Date().toISOString(),

        frameCount:
            recordedFrames.length,

        frames:
            recordedFrames

    };


    const json =
        JSON.stringify(
            recording,
            null,
            2
        );


    const blob =
        new Blob(
            [json],
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
        new Date()
            .toISOString()
            .replaceAll(
                ":",
                "-"
            );


    link.href =
        url;


    link.download =
        `${VEHICLE_ID}_${timestamp}.json`;


    document.body.appendChild(
        link
    );


    link.click();


    document.body.removeChild(
        link
    );


    URL.revokeObjectURL(
        url
    );

}



// ============================================================
// REPLAY
// ============================================================

// ============================================================
// Load recording
// ============================================================

function loadRecording(
    event
)
{

    const file =
        event.target.files[0];


    if (!file) {

        return;
    }


    const reader =
        new FileReader();


    reader.onload =
        function (loadEvent)
        {

            try {

                const recording =
                    JSON.parse(
                        loadEvent.target.result
                    );


                if (
                    !Array.isArray(
                        recording.frames
                    )
                ) {

                    throw new Error(
                        "Recording does not contain a frames array"
                    );

                }


                if (
                    recording.frames.length === 0
                ) {

                    throw new Error(
                        "Recording contains no frames"
                    );

                }


                // --------------------------------------------
                // Stop recording if active
                // --------------------------------------------

                if (isRecording) {

                    stopRecording();

                }


                // --------------------------------------------
                // Stop previous replay
                // --------------------------------------------

                stopReplay();


                replayRecording =
                    recording;


                replayFrames =
                    recording.frames;


                replayIndex =
                    0;


                replaySlider.min =
                    0;


                replaySlider.max =
                    replayFrames.length - 1;


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


                displayReplayFrame(
                    0
                );


                updateReplayStatus();


            }
            catch (error) {

                alert(
                    "Unable to load recording:\n" +
                    error.message
                );

            }

        };


    reader.readAsText(
        file
    );

}



// ============================================================
// Display replay frame
// ============================================================

function displayReplayFrame(
    index
)
{

    if (
        replayFrames.length === 0
    ) {

        return;
    }


    index =
        Math.max(
            0,
            Math.min(
                index,
                replayFrames.length - 1
            )
        );


    replayIndex =
        index;


    const frame =
        replayFrames[
            replayIndex
        ];


    /*
     * Version 1 recordings contain:
     *
     * {
     *     receivedAt: ...,
     *     data: {...}
     * }
     */

    const telemetry =
        frame.data ?? frame;


    updateDashboard(
        telemetry
    );


    replaySlider.value =
        replayIndex;


    updateReplayStatus();

}



// ============================================================
// Play
// ============================================================

function playReplay()
{

    if (
        replayFrames.length === 0
    ) {

        return;
    }


    // Pause

    if (replayPlaying) {

        pauseReplay();

        return;
    }


    // Restart if we're at the end

    if (
        replayIndex >=
        replayFrames.length - 1
    ) {

        replayIndex =
            0;

    }


    replayPlaying =
        true;


    playReplayButton.textContent =
        "Pause";


    scheduleNextReplayFrame();

}



// ============================================================
// Pause
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
// Schedule next replay frame
// ============================================================

function scheduleNextReplayFrame()
{

    if (!replayPlaying) {

        return;
    }


    if (
        replayIndex >=
        replayFrames.length - 1
    ) {

        pauseReplay();

        updateReplayStatus();

        return;
    }


    const current =
        replayFrames[
            replayIndex
        ];


    const next =
        replayFrames[
            replayIndex + 1
        ];


    // --------------------------------------------------------
    // Calculate original timing
    // --------------------------------------------------------

    let delay = 100;


    if (
        current.receivedAt !== undefined &&
        next.receivedAt !== undefined
    ) {

        delay =
            next.receivedAt -
            current.receivedAt;

    }


    // Prevent bad timestamps from creating ridiculous delays

    if (
        !Number.isFinite(delay) ||
        delay < 1
    ) {

        delay =
            1;

    }


    // --------------------------------------------------------
    // Replay speed
    // --------------------------------------------------------

    const speed =
        Number(
            replaySpeed.value
        );


    delay =
        delay / speed;


    replayTimer =
        setTimeout(
            () =>
            {

                replayIndex++;


                displayReplayFrame(
                    replayIndex
                );


                scheduleNextReplayFrame();

            },
            delay
        );

}



// ============================================================
// Stop replay
// ============================================================

function stopReplay()
{

    pauseReplay();


    if (
        replayFrames.length > 0
    ) {

        replayIndex =
            0;


        replaySlider.value =
            0;

    }

}



// ============================================================
// Previous frame
// ============================================================

function previousReplayFrame()
{

    pauseReplay();


    if (
        replayIndex > 0
    ) {

        displayReplayFrame(
            replayIndex - 1
        );

    }

}



// ============================================================
// Next frame
// ============================================================

function nextReplayFrame()
{

    pauseReplay();


    if (
        replayIndex <
        replayFrames.length - 1
    ) {

        displayReplayFrame(
            replayIndex + 1
        );

    }

}



// ============================================================
// Seek
// ============================================================

function seekReplay()
{

    pauseReplay();


    const index =
        Number(
            replaySlider.value
        );


    displayReplayFrame(
        index
    );

}



// ============================================================
// Replay status
// ============================================================

function updateReplayStatus()
{

    if (
        replayFrames.length === 0
    ) {

        document.getElementById(
            "replayStatus"
        ).textContent =
            "No recording loaded";


        return;
    }


    const frame =
        replayFrames[
            replayIndex
        ];


    const telemetry =
        frame.data ?? frame;


    document.getElementById(
        "replayStatus"
    ).textContent =

        `Replay frame ${replayIndex + 1} / ` +
        `${replayFrames.length} ` +
        `(Telemetry frame ${telemetry.frameNumber ?? "--"})`;

}



// ============================================================
// Event handlers
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
    saveRecording
);


replayFileInput.addEventListener(
    "change",
    loadRecording
);


playReplayButton.addEventListener(
    "click",
    playReplay
);


stopReplayButton.addEventListener(
    "click",
    stopReplay
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
// Start
// ============================================================

connectWebSocket();
