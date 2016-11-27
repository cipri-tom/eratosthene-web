"use strict";


// constants
var HOST = "ws://127.0.0.1:43420"

var CELL_DATA_SIZE = 3 * 1;    // RGB 1-byte colour
var CELL_POSE_SIZE = 3 * 8;    // longitude, latitude, altitude as double precision
var CELL_SIZE = CELL_DATA_SIZE + CELL_POSE_SIZE;

function num2bytes(num) {
    var bytes = [];
    for (var i = 0; i < 8; ++i) {
        bytes[i] = num & 0xFF;
        num = num >> 8;
    }
    return bytes;
}

function spherical_to_cartesian(pose) {
    /** Modifies IN PLACE!
        Input: [lon, lat, rad] --- Output: [x, y, z] */
    pose[2] = Math.cos(pose[1]) * Math.cos(pose[0]);
    pose[0] = Math.cos(pose[1]) * Math.sin(pose[0]);
    pose[1] = Math.sin(pose[1]);
    return pose;  // not really needed
}


function Cell(addrStr) {
    // keep reference to itself to be accessed from private functions
    var self = this;

    // forward declarations
    var socket = null, num_messages = 0;  // for the network interface

    self.addr = new Address(addrStr);
    self.edge = null;
    self.callback = null;
    self.geometry = null;

    function auth_and_send() {
        /* Callback for the first message on the socket.
         * Checks it is correctly authenticating the socket
         * Should not be called directly! Pairs with `connect`
         */
        Util.Info(`Receiving auth: ${socket.rQlen()} bytes`);
        var r = socket.rQshift32();  // 4 bytes, littleEndian
        if ((r & 0x7F) === 2) {
            // auth succeeded, now we're ready to receive messages:
            socket.on('message', receive);
            console.time("networking");
            socket.send(self.addr.to_bytes());
        }
        else
            throw "Failed to authenticate socket";
    }

    function receive() {
        /** Called for received messages after a query was sent.
            Since the data we need may arrive in multiple messages, we postpone
            the reconstruction 'till the end.

            Performance: consider bypassing websock and storing the buffers
            themselves then reconstructing with a (Blob + FileReader) at the end
         */
        num_messages++;
    }

    function close_and_read() {
        console.timeEnd("networking");
        console.time("constructing");
        Util.Info(`received ${socket.rQlen()} bytes in ${num_messages} messages`);

        self.edge = self.addr.get_pose();
        spherical_to_cartesian(self.edge);

        var received_bytes = socket.get_rQ(),
            start = socket.get_rQi();
        var dv = new DataView(new Uint8Array(received_bytes).buffer, start);
        var offset = 0, pose_offset = 0, data_offset = 0;
        var pose = [0.0, 0.0, 0.0];  // prealocate; either [lon, lat, rad] or [x, y, z]

        if (dv.byteLength % CELL_SIZE !== 0)
            Util.Warn("WARNING: there are leftover bytes in transmission");
        var num_points = Math.floor(dv.byteLength / CELL_SIZE);

        var positions = new Float32Array(3 * num_points);
        var colors    = new Uint8Array(3 * num_points);

        for (var curr_pt = 0; curr_pt < num_points; curr_pt++) {
            // offsets are updated after each extraction; check if they are correct
            if (         offset !== curr_pt * CELL_SIZE
                 || pose_offset !== curr_pt * 3
                 || data_offset !== curr_pt * 3)
                throw "Mis-aligned reading detected";

            pose[0] = dv.getFloat64(offset     , true);  // true == little endian
            pose[1] = dv.getFloat64(offset + 8 , true);
            pose[2] = dv.getFloat64(offset + 16, true);
            offset += CELL_POSE_SIZE;

            // convert and translate relative to edge
            spherical_to_cartesian(pose);
            pose[0] = EARTH_ALTITUDE * (pose[0] - self.edge[0]);
            pose[1] = EARTH_ALTITUDE * (pose[1] - self.edge[1]);
            pose[2] = EARTH_ALTITUDE * (pose[2] - self.edge[2]);

            // push in the cell's data
            positions[pose_offset    ] = pose[0];
            positions[pose_offset + 1] = pose[1];
            positions[pose_offset + 2] = pose[2];
            pose_offset += 3;  // number of extracted values

            // extract data -- consider parsing in a separate loop over Uint8Array
            colors[data_offset    ] = dv.getUint8(offset)    ;
            colors[data_offset + 1] = dv.getUint8(offset + 1);
            colors[data_offset + 2] = dv.getUint8(offset + 2);
            offset += CELL_DATA_SIZE;
            data_offset += 3;
        }

        self.geometry = new THREE.BufferGeometry();
        self.geometry.addAttribute('position', new THREE.BufferAttribute(positions, 3));
        self.geometry.addAttribute('color'   , new THREE.BufferAttribute(colors   , 3, true)); // true -- normalise

        console.timeEnd("constructing");
        socket = null;   // dispose
        // console.log(self);

        // finished, use callback
        if (self.callback)
            self.callback(self);
    }

    function connect() {
        // Connects and authenticates this address' socket to the server
        if (socket === null) {
            socket = new Websock();
            socket.on('open', function sendAuth() {
                Util.Info("Sending auth");
                socket.send([2, 0, 0, 0]);
            });

            // first message is processed to check authentication
            socket.on("message", auth_and_send);
            socket.on("close"  , close_and_read);

            socket.open(HOST, 'binary');
        }
        else
            throw "Socket already connected";
    }

    self.query = function(callback) {
        connect();  // falls through auth -> send -> receive
        if (callback)
            self.callback = callback;
    }

    return self;
}

