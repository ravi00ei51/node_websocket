const port = process.env.PORT || 3000;
const http = require('http')
const express = require('express')

const app = express();
const server = http.createServer(app)

server.listen(port, function(){
    console.log('Server Running '+ port);
})

const websocket = require('ws')

const wss = new websocket.Server({server})

wss.on('connection', function (ws) {
    ws.send('Thanks for connecting');
    console.log('new connection')

    ws.on('message', function (data) {
        console.log('New type message : ' + data.length);
        console.log('ws type message : ' + ws.binaryType );
        if(data.length === 5) {
            ws.send('Thanks for sending text' + data);
            console.log('New text message: ' + data);
        } else if(data.length === 10) {
            ws.send('Thanks for sending binary' + data);
            console.log('New binary message: ' + data.toString('hex'));
        }
    })
    ws.on('close', (code, message) => {
       console.log('Close connection:: ', code);
       ws.close();
     });
})
