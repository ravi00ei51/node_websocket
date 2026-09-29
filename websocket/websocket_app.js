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
// Health
// ============================================================

app.get("/health", (req, res) => {

    res.json({
        status: "ok",
        connectedClients: wss.clients.size
    });

});


// ============================================================
// WebSocket
// ============================================================

wss.on("connection", (ws, request) => {

    console.log("");
    console.log("======================================");
    console.log("New WebSocket connection");
    console.log("Remote:", request.socket.remoteAddress);
    console.log("Connected clients:", wss.clients.size);


    ws.clientRole = null;
    ws.vehicleId = null;
    ws.handshakeComplete = false;


    // ========================================================
    // Handshake timeout
    // ========================================================

    const handshakeTimer =
        setTimeout(() => {

            if (!ws.handshakeComplete) {

                console.log(
                    "Handshake timeout"
                );

                ws.close(
                    1008,
                    "Handshake timeout"
                );
            }

        }, HANDSHAKE_TIMEOUT_MS);


    // ========================================================
    // Incoming message
    // ========================================================

    ws.on("message", (data, isBinary) => {


        // ====================================================
        // HANDSHAKE
        // ====================================================

        if (!ws.handshakeComplete) {

            if (isBinary) {

                ws.close(
                    1008,
                    "Handshake must be JSON text"
                );

                return;
            }


            let handshake;


            try {

                handshake =
                    JSON.parse(
                        data.toString()
                    );

            }
            catch (error) {

                ws.close(
                    1008,
                    "Invalid handshake JSON"
                );

                return;
            }


            if (
                handshake.type !==
                "handshake"
            ) {

                ws.close(
                    1008,
                    "Handshake required"
                );

                return;
            }


            if (
                handshake.role !== "jetson" &&
                handshake.role !== "browser"
            ) {

                ws.close(
                    1008,
                    "Invalid role"
                );

                return;
            }


            if (
                typeof handshake.vehicleId !== "string" ||
                handshake.vehicleId.length === 0
            ) {

                ws.close(
                    1008,
                    "Vehicle ID required"
                );

                return;
            }


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


            ws.send(
                JSON.stringify({
                    type: "handshake_ack",
                    status: "ok",
                    role: ws.clientRole,
                    vehicleId: ws.vehicleId
                })
            );


            return;
        }


        // ====================================================
        // JETSON TELEMETRY
        // ====================================================

        if (
            ws.clientRole ===
            "jetson"
        ) {

            let forwardedClients = 0;


            wss.clients.forEach(
                (client) => {

                    if (
                        client !== ws &&
                        client.readyState === WebSocket.OPEN &&
                        client.handshakeComplete === true &&
                        client.clientRole === "browser" &&
                        client.vehicleId === ws.vehicleId
                    ) {

                        client.send(
                            data,
                            {
                                binary: isBinary
                            }
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


        // ====================================================
        // Browser messages
        // ====================================================

        if (
            ws.clientRole ===
            "browser"
        ) {

            console.log(
                `Ignoring message from browser ${ws.vehicleId}`
            );

        }

    });


    // ========================================================
    // Close
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


        if (reason.length > 0) {

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
    // Error
    // ========================================================

    ws.on("error", (error) => {

        console.error(
            "WebSocket error:",
            error.message
        );

    });

});


// ============================================================
// Start
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
        console.log(`Dashboard: http://localhost:${port}`);
        console.log(`Health:    http://localhost:${port}/health`);
        console.log("");
        console.log("Waiting for connections...");
        console.log("");

    }
);
