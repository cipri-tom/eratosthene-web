// Util.init_logging('debug');
"use strict";

// constants
var LE_NETWORK_SB_ADDR = 88; // default length of address buffer
var HOST = "ws://127.0.0.1:43420"

function num2bytes(num) {
    let bytes = [];
    for (let i = 0; i < 8; ++i) {
        bytes[i] = num & 0xFF;
        num = num >> 8;
    }
    return bytes;
}

function Address(addrStr) {
    // keep reference to itself to be accessed from private functions
    var self = this;

    // fields
    self.time = self.depth = self.size = 0;
    self.digits = [];
    let socket = null;
    let num_messages = 0;
    let data = [];


    // construct from string
    if (addrStr) {
        let parts = addrStr.split('/');
        if (parts.length != 4 || parts[0] || !parts[1] || !parts[2] || !parts[3])
            throw("Invalid address");

        self.time = parseInt(parts[1]);
        self.size = parts[2].length;
        for (let i = 0; i < self.size; ++i)
            self.digits.push(parts[2][i]);
        self.depth = parseInt(parts[3]);
    }

    function toBytes() {
        let bytes = [];
        bytes = bytes.concat(num2bytes(self.size));
        bytes = bytes.concat(num2bytes(self.time));
        bytes = bytes.concat(num2bytes(self.depth));
        bytes = bytes.concat(self.digits);
        for (let i = bytes.length; i < LE_NETWORK_SB_ADDR; ++i)
            bytes[i] = 0;
        return bytes;
    }

    function auth_and_send(message_buf) {
        /* Callback for the first message on the socket.
         * Checks it is correctly authenticating the socket
         * Should not be called directly! Pairs with `connect`
         */
        console.log("Receiving auth");
        // let r = new Int32Array(message_buf);  // 4 bytes
        let r = new DataView(message_buf).getInt32(0, true);  // 4 bytes, littleEndian
        if ((r & 0x7F) === 2) {
            // auth succeeded, now we're ready to receive messages:
            socket.on('message', receive);
            socket.send(toBytes());
        }
        else
            throw "Failed to authenticate socket";
    }

    function receive(message_buf) {
        num_messages++;
        let message = new Float64Array(message_buf);
        for (let i = 0; i < message.length; ++i)
            data.push(message);
    }

    function close_conn() {
        socket = null;
        console.log("received messages: " + num_messages);
        console.log(data);
    }


    function connect() {
        // Connects and authenticates this address' socket to the server
        if (socket === null) {
            socket = new Websock();
            socket.on('open', function sendAuth() {
                console.log("Sending auth");
                socket.send([2, 0, 0, 0]);
            });

            // first message is processed to check authentication
            socket.on("message", auth_and_send);
            socket.on("close"  , close_conn);

            socket.open(HOST, 'binary');
        }
        else
            throw "Socket already connected";
    }

    self.query = function() {
        connect();  // falls through auth -> send -> receive
    }

    return self;
}


// conn.open("ws://127.0.0.1:43427", "binary");
// let addr = new Address("/950486422/122010001340232/1");

// setTimeout(conn.send, 2000, addr.toBytes());

function query(addr_str) {
    let addr = new Address(addr_str);
    addr.query();
}

// conn.close();


