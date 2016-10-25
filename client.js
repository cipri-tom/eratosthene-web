// Util.init_logging('debug');
"use strict";

var LE_NETWORK_SB_ADDR = 88;
var HOST = "ws://127.0.0.1:43420"


function Address(addrStr) {
    // fields
    this.time = this.depth = this.size = 0;
    this.digits = [];
    this.socket = null;

    if (addrStr) {
        let parts = addrStr.split('/');
        if (parts.length != 4 || parts[0] || !parts[1] || !parts[2] || !parts[3])
            throw("Invalid address");

        this.time = parseInt(parts[1]);
        this.size = parts[2].length;
        for (let i = 0; i < this.size; ++i)
            this.digits.push(parts[2][i]);
        this.depth = parseInt(parts[3]);
    }

    this.toBytes = function() {
        let bytes = [];
        bytes = bytes.concat(num2bytes(this.size));
        bytes = bytes.concat(num2bytes(this.time));
        bytes = bytes.concat(num2bytes(this.depth));
        bytes = bytes.concat(this.digits);
        for (let i = bytes.length; i < LE_NETWORK_SB_ADDR; ++i)
            bytes[i] = 0;
        return bytes;
    }

    this.connect = function () {
        if (this.socket == null) {
            this.socket = new Websock();
            this.socket.waithingAuth = true;
            this.socket.on("message", this.connect);  // return here until auth
            this.socket.on("close"  , this.close_conn);

            this.socket.open(HOST, 'binary');
            authenticate(this.socket);
        }
        else if (this.socket.waitingAuth) {
            // it arrives here on first message
            this.socket.waitingAuth = false;
            // now we are ready to receive messages
            this.socket.on("message", this.receive);
        }
        else
            throw "Socket already connected";
    }

    this.receive = function () {
        // TODO
    }

    this.close_conn = function () {
        this.socket = null;
    }


    this.query = function() {
        connect();
        socket.send(this.toBytes());
    }

    return this;
}

function num2bytes(num) {
    let bytes = [];
    for (let i = 0; i < 8; ++i) {
        bytes[i] = num & 0xFF;
        num = num >> 8;
    }
    return bytes;
}



function authenticate(socket) {
    socket.send([2, 0, 0, 0]);

    // wait for the first reply to arrive
    let num_tries = 10;
    let poll = setInterval(function waitReply() {
        if (socket.waitingAuth === true) {
            if (num_tries > 0) {
                num_tries--;
                return;
            }
            clearInterval(poll);
            throw "Timeout while authenticating socket";
        }
        clearInterval(poll);
        let r = socket.rQshift32();
        if ((r & 0x7F) === 2)
            socket.auth = true;
        else
            throw "Failed to authenticate socket";
    }, 100);
}


conn.on('open', function() {
    console.log("Opened!");
    authenticate(conn);
});

conn.on('message', function() {
    if (conn.waitingAuth === true)
        conn.waitingAuth = false;
    else {

    }

    // console.log("New message!");
});

conn.on('close', function(event) {
    console.log("Closed! Cause: " + event.reason);
});

conn.on('error', function(msg) {
    console.log("Error: ");
    console.log(msg);
});

// conn.open("ws://127.0.0.1:43427", "binary");
// let addr = new Address("/950486422/122010001340232/1");

// setTimeout(conn.send, 2000, addr.toBytes());

function query(addr) {
    addr = new Address(addr);
}

// conn.close();


