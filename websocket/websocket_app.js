const http = require('http')
const express = require('express')

const app = express();
const server = http.createServer(app)

server.listen(1337, function(){
    console.log('Server Running');
})

const websocket = require('ws')

const wss = new websocket.Server({server})

wss.on('connection', function (ws) {
    ws.send('Thanks for connecting');
    console.log('new connection')

    ws.on('message', function (data) {
        ws.send('Thanks for sending ' + data);
        console.log('New message: ' + data);
    })
})
