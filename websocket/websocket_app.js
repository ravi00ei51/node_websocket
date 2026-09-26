const port = process.env.PORT || 3000;

const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const path = require("path");


// ============================================================
// Express
// ============================================================

const app = express();


// Serve files from:
//
// node_websocket/public/
//
// For example:
// public/index.html
//
app.use(
    express.static(
        path.join(__dirname, "..", "public")
    )
);


// ============================================================
// HTTP Server
// ============================================================

const server = http.createServer(app);


// ============================================================
// WebSocket Server
// ============================================================

const wss = new WebSocket.Server({
    server
});

const HANDSHAKE_TIMEOUT_MS = 5000;


// ============================================================
// Health endpoint
// ============================================================

app.get("/health", (req, res) => {

    res.json({
        status: "ok",
        connectedClients: wss.clients.size
    });

});


// ============================================================
// WebSocket connection
// ============================================================

wss.on("connection", (ws, request) => {

    console.log("");
    console.log("======================================");
    console.log("New WebSocket connection");
    console.log("Remote:", request.socket.remoteAddress);
    console.log("Connected clients:", wss.clients.size);


    // --------------------------------------------------------
    // Information associated with this WebSocket connection
    // --------------------------------------------------------

    ws.clientRole = null;
    ws.vehicleId = null;
    ws.handshakeComplete = false;


    // --------------------------------------------------------
    // Handshake timeout
    // --------------------------------------------------------

    const handshakeTimer = setTimeout(() => {

        if (!ws.handshakeComplete) {

            console.log("Handshake timeout");

            ws.close(
                1008,
                "Handshake timeout"
            );
        }

    }, HANDSHAKE_TIMEOUT_MS);


    // ========================================================
    // Incoming WebSocket message
    // ========================================================

    ws.on("message", (data, isBinary) => {


        // ====================================================
        // HANDSHAKE
        // ====================================================

        if (!ws.handshakeComplete) {


            // Handshake must be text JSON

            if (isBinary) {

                console.log(
                    "Handshake must be JSON text"
                );

                ws.close(
                    1008,
                    "Handshake must be JSON text"
                );

                return;
            }


            let handshake;


            // ------------------------------------------------
            // Parse handshake JSON
            // ------------------------------------------------

            try {

                handshake =
                    JSON.parse(
                        data.toString()
                    );

            }
            catch (error) {

                console.log(
                    "Invalid handshake JSON"
                );

                ws.close(
                    1008,
                    "Invalid handshake JSON"
                );

                return;
            }


            // ------------------------------------------------
            // Validate message type
            // ------------------------------------------------

            if (
                handshake.type !== "handshake"
            ) {

                console.log(
                    "Handshake required"
                );

                ws.close(
                    1008,
                    "Handshake required"
                );

                return;
            }


            // ------------------------------------------------
            // Validate role
            // ------------------------------------------------

            if (
                handshake.role !== "jetson" &&
                handshake.role !== "browser"
            ) {

                console.log(
                    "Invalid role:",
                    handshake.role
                );

                ws.close(
                    1008,
                    "Invalid role"
                );

                return;
            }


            // ------------------------------------------------
            // Validate vehicle ID
            // ------------------------------------------------

            if (
                typeof handshake.vehicleId !== "string" ||
                handshake.vehicleId.length === 0
            ) {

                console.log(
                    "Vehicle ID required"
                );

                ws.close(
                    1008,
                    "Vehicle ID required"
                );

                return;
            }


            // ------------------------------------------------
            // Store client information
            // ------------------------------------------------

            ws.clientRole =
                handshake.role;

            ws.vehicleId =
                handshake.vehicleId;

            ws.handshakeComplete =
                true;


            clearTimeout(
                handshakeTimer
            );


            console.log(
                `Handshake OK: role=${ws.clientRole}, ` +
                `vehicle=${ws.vehicleId}`
            );


            // ------------------------------------------------
            // Send handshake acknowledgement
            // ------------------------------------------------

            ws.send(
                JSON.stringify({

                    type:
                        "handshake_ack",

                    status:
                        "ok",

                    role:
                        ws.clientRole,

                    vehicleId:
                        ws.vehicleId

                })
            );


            return;
        }



        // ====================================================
        // JETSON MESSAGE
        // ====================================================

        if (
            ws.clientRole === "jetson"
        ) {

            let forwardedClients = 0;


            /*
             * IMPORTANT
             *
             * We intentionally DO NOT parse the telemetry.
             *
             * The message received from the Jetson is
             * forwarded unchanged to every browser subscribed
             * to the same vehicle ID.
             */


            wss.clients.forEach((client) => {


                if (
                    client !== ws &&

                    client.readyState ===
                        WebSocket.OPEN &&

                    client.handshakeComplete ===
                        true &&

                    client.clientRole ===
                        "browser" &&

                    client.vehicleId ===
                        ws.vehicleId
                ) {


                    client.send(
                        data,
                        {
                            binary: isBinary
                        }
                    );


                    forwardedClients++;

                }

            });


            console.log(
                `Telemetry from ${ws.vehicleId}: ` +
                `${data.length} bytes -> ` +
                `${forwardedClients} browser(s)`
            );


            return;
        }



        // ====================================================
        // BROWSER MESSAGE
        // ====================================================

        if (
            ws.clientRole === "browser"
        ) {

            /*
             * Browser is currently receive-only.
             *
             * Later we could add commands here:
             *
             * start_logging
             * stop_logging
             * request_status
             * change_configuration
             * etc.
             */

            console.log(
                `Ignoring message from browser ` +
                `${ws.vehicleId}`
            );


            return;
        }

    });



    // ========================================================
    // Connection closed
    // ========================================================

    ws.on("close", (code, reason) => {

        clearTimeout(
            handshakeTimer
        );


        console.log("");
        console.log("Client disconnected");

        console.log(
            "Role:",
            ws.clientRole || "unknown"
        );

        console.log(
            "Vehicle:",
            ws.vehicleId || "unknown"
        );

        console.log(
            "Code:",
            code
        );


        if (
            reason.length > 0
        ) {

            console.log(
                "Reason:",
                reason.toString()
            );

        }


        console.log(
            "Connected clients:",
            wss.clients.size
        );

    });



    // ========================================================
    // WebSocket error
    // ========================================================

    ws.on("error", (error) => {

        console.error(
            "WebSocket error:",
            error.message
        );

    });

});


// ============================================================
// Start server
// ============================================================

server.listen(
    port,
    "0.0.0.0",
    () => {

        console.log("");
        console.log("======================================");
        console.log(" Vehicle Telemetry WebSocket Server");
        console.log("======================================");
        console.log(`Port: ${port}`);
        console.log("");
        console.log("Dashboard:");
        console.log(`http://localhost:${port}`);
        console.log("");
        console.log("Health:");
        console.log(`http://localhost:${port}/health`);
        console.log("");
        console.log("Waiting for connections...");
        console.log("");

    }
);
