const port = process.env.PORT || 3000;

const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const path = require("path");


// ============================================================
// Express
// ============================================================

const app = express();

app.use(
    express.static(
        path.join(__dirname, "..", "public")
    )
);


// ============================================================
// HTTP server
// ============================================================

const server =
    http.createServer(app);


// ============================================================
// WebSocket server
// ============================================================

const wss =
    new WebSocket.Server({
        server
    });


const HANDSHAKE_TIMEOUT_MS =
    5000;


// ============================================================
// Connected vehicle registry
//
// vehicleId ->
// {
//     socket,
//     vehicleId,
//     vehicleName,
//     connectedAt
// }
// ============================================================

const vehicles =
    new Map();



// ============================================================
// Health
// ============================================================

app.get(
    "/health",
    (req, res) =>
    {

        res.json({

            status:
                "ok",

            connectedClients:
                wss.clients.size,

            connectedVehicles:
                vehicles.size

        });

    }
);



// ============================================================
// Get vehicle list
// ============================================================

function getVehicleList()
{

    const list =
        [];


    vehicles.forEach(
        (vehicle) =>
        {

            list.push({

                vehicleId:
                    vehicle.vehicleId,

                vehicleName:
                    vehicle.vehicleName,

                connectedAt:
                    vehicle.connectedAt

            });

        }
    );


    return list;
}



// ============================================================
// Send message safely
// ============================================================

function sendJson(
    socket,
    message
)
{

    if (
        socket.readyState !==
        WebSocket.OPEN
    )
    {

        return;
    }


    socket.send(
        JSON.stringify(
            message
        )
    );

}



// ============================================================
// Broadcast to browsers
// ============================================================

function broadcastToBrowsers(
    message
)
{

    const json =
        JSON.stringify(
            message
        );


    wss.clients.forEach(
        (client) =>
        {

            if (
                client.readyState === WebSocket.OPEN &&
                client.handshakeComplete === true &&
                client.clientRole === "browser"
            )
            {

                client.send(
                    json
                );

            }

        }
    );

}



// ============================================================
// Send complete vehicle list to one browser
// ============================================================

function sendVehicleList(
    socket
)
{

    sendJson(
        socket,
        {

            type:
                "vehicle_list",

            vehicles:
                getVehicleList()

        }
    );

}



// ============================================================
// WebSocket connection
// ============================================================

wss.on(
    "connection",
    (ws, request) =>
    {

        console.log("");
        console.log("======================================");
        console.log("New WebSocket connection");
        console.log(
            "Remote:",
            request.socket.remoteAddress
        );


        ws.clientRole =
            null;

        ws.vehicleId =
            null;

        ws.vehicleName =
            null;

        ws.handshakeComplete =
            false;



        // ====================================================
        // Handshake timeout
        // ====================================================

        const handshakeTimer =
            setTimeout(
                () =>
                {

                    if (
                        !ws.handshakeComplete
                    )
                    {

                        console.log(
                            "Handshake timeout"
                        );


                        ws.close(
                            1008,
                            "Handshake timeout"
                        );

                    }

                },
                HANDSHAKE_TIMEOUT_MS
            );



        // ====================================================
        // Incoming message
        // ====================================================

        ws.on(
            "message",
            (data, isBinary) =>
            {

                // ============================================
                // HANDSHAKE
                // ============================================

                if (
                    !ws.handshakeComplete
                )
                {

                    if (isBinary)
                    {

                        ws.close(
                            1008,
                            "Handshake must be JSON"
                        );

                        return;
                    }


                    let handshake;


                    try
                    {

                        handshake =
                            JSON.parse(
                                data.toString()
                            );

                    }
                    catch
                    {

                        ws.close(
                            1008,
                            "Invalid handshake JSON"
                        );

                        return;
                    }


                    if (
                        handshake.type !==
                        "handshake"
                    )
                    {

                        ws.close(
                            1008,
                            "Handshake required"
                        );

                        return;
                    }


                    if (
                        handshake.role !== "jetson" &&
                        handshake.role !== "browser"
                    )
                    {

                        ws.close(
                            1008,
                            "Invalid role"
                        );

                        return;
                    }


                    // ========================================
                    // JETSON HANDSHAKE
                    // ========================================

                    if (
                        handshake.role ===
                        "jetson"
                    )
                    {

                        if (
                            typeof handshake.vehicleId !== "string" ||
                            handshake.vehicleId.length === 0
                        )
                        {

                            ws.close(
                                1008,
                                "Vehicle ID required"
                            );

                            return;
                        }


                        ws.clientRole =
                            "jetson";


                        ws.vehicleId =
                            handshake.vehicleId;


                        ws.vehicleName =
                            (
                                typeof handshake.vehicleName === "string" &&
                                handshake.vehicleName.length > 0
                            )
                                ? handshake.vehicleName
                                : handshake.vehicleId;


                        ws.handshakeComplete =
                            true;


                        clearTimeout(
                            handshakeTimer
                        );


                        // ------------------------------------
                        // Replace previous connection
                        // ------------------------------------

                        const previousVehicle =
                            vehicles.get(
                                ws.vehicleId
                            );


                        if (
                            previousVehicle &&
                            previousVehicle.socket !== ws
                        )
                        {

                            console.log(
                                `Replacing previous connection for ${ws.vehicleId}`
                            );


                            previousVehicle.socket.close(
                                1000,
                                "Replaced by new connection"
                            );

                        }


                        const vehicle = {

                            socket:
                                ws,

                            vehicleId:
                                ws.vehicleId,

                            vehicleName:
                                ws.vehicleName,

                            connectedAt:
                                new Date().toISOString()

                        };


                        vehicles.set(
                            ws.vehicleId,
                            vehicle
                        );


                        console.log(
                            `Jetson connected: ` +
                            `${ws.vehicleId} ` +
                            `(${ws.vehicleName})`
                        );


                        sendJson(
                            ws,
                            {

                                type:
                                    "handshake_ack",

                                status:
                                    "ok",

                                role:
                                    "jetson",

                                vehicleId:
                                    ws.vehicleId

                            }
                        );


                        // Tell all dashboards

                        broadcastToBrowsers(
                            {

                                type:
                                    "vehicle_connected",

                                vehicle:
                                    {

                                        vehicleId:
                                            vehicle.vehicleId,

                                        vehicleName:
                                            vehicle.vehicleName,

                                        connectedAt:
                                            vehicle.connectedAt

                                    }

                            }
                        );


                        return;
                    }



                    // ========================================
                    // BROWSER HANDSHAKE
                    // ========================================

                    ws.clientRole =
                        "browser";


                    ws.handshakeComplete =
                        true;


                    clearTimeout(
                        handshakeTimer
                    );


                    console.log(
                        "Browser dashboard connected"
                    );


                    sendJson(
                        ws,
                        {

                            type:
                                "handshake_ack",

                            status:
                                "ok",

                            role:
                                "browser"

                        }
                    );


                    // Immediately give browser all vehicles

                    sendVehicleList(
                        ws
                    );


                    return;
                }



                // ============================================
                // TELEMETRY FROM JETSON
                // ============================================

                if (
                    ws.clientRole ===
                    "jetson"
                )
                {

                    if (isBinary)
                    {

                        console.log(
                            `Ignoring binary telemetry from ${ws.vehicleId}`
                        );

                        return;
                    }


                    let telemetry;


                    try
                    {

                        telemetry =
                            JSON.parse(
                                data.toString()
                            );

                    }
                    catch
                    {

                        console.log(
                            `Invalid telemetry JSON from ${ws.vehicleId}`
                        );

                        return;
                    }


                    const message = {

                        type:
                            "telemetry",

                        vehicleId:
                            ws.vehicleId,

                        vehicleName:
                            ws.vehicleName,

                        serverReceivedAt:
                            Date.now(),

                        data:
                            telemetry

                    };


                    let forwardedClients =
                        0;


                    const json =
                        JSON.stringify(
                            message
                        );


                    wss.clients.forEach(
                        (client) =>
                        {

                            if (
                                client.readyState === WebSocket.OPEN &&
                                client.handshakeComplete === true &&
                                client.clientRole === "browser"
                            )
                            {

                                client.send(
                                    json
                                );


                                forwardedClients++;

                            }

                        }
                    );


                    console.log(
                        `Telemetry from ${ws.vehicleId}: ` +
                        `${data.length} bytes -> ` +
                        `${forwardedClients} browser(s)`
                    );


                    return;
                }



                // ============================================
                // Browser messages
                // ============================================

                if (
                    ws.clientRole ===
                    "browser"
                )
                {

                    console.log(
                        "Ignoring browser message"
                    );

                }

            }
        );



        // ====================================================
        // Disconnect
        // ====================================================

        ws.on(
            "close",
            (code, reason) =>
            {

                clearTimeout(
                    handshakeTimer
                );


                console.log("");
                console.log(
                    "Client disconnected"
                );

                console.log(
                    "Role:",
                    ws.clientRole || "unknown"
                );

                console.log(
                    "Vehicle:",
                    ws.vehicleId || "N/A"
                );

                console.log(
                    "Code:",
                    code
                );


                if (
                    reason.length > 0
                )
                {

                    console.log(
                        "Reason:",
                        reason.toString()
                    );

                }


                // --------------------------------------------
                // Remove vehicle only if this socket is still
                // the registered socket.
                // --------------------------------------------

                if (
                    ws.clientRole === "jetson" &&
                    ws.vehicleId
                )
                {

                    const registeredVehicle =
                        vehicles.get(
                            ws.vehicleId
                        );


                    if (
                        registeredVehicle &&
                        registeredVehicle.socket === ws
                    )
                    {

                        vehicles.delete(
                            ws.vehicleId
                        );


                        console.log(
                            `Vehicle removed: ${ws.vehicleId}`
                        );


                        broadcastToBrowsers(
                            {

                                type:
                                    "vehicle_disconnected",

                                vehicleId:
                                    ws.vehicleId

                            }
                        );

                    }

                }

            }
        );



        // ====================================================
        // Error
        // ====================================================

        ws.on(
            "error",
            (error) =>
            {

                console.error(
                    "WebSocket error:",
                    error.message
                );

            }
        );

    }
);



// ============================================================
// Start server
// ============================================================

server.listen(
    port,
    "0.0.0.0",
    () =>
    {

        console.log("");
        console.log("======================================");
        console.log(" Multi-Vehicle Telemetry Server");
        console.log("======================================");
        console.log(`Port: ${port}`);
        console.log("");
        console.log(`Dashboard: http://localhost:${port}`);
        console.log(`Health:    http://localhost:${port}/health`);
        console.log("");
        console.log("Waiting for connections...");
        console.log("");

    }
);
