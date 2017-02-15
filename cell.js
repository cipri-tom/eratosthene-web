"use strict";

// constants
var HOST = "ws://127.0.0.1:43427"

var CELL_DATA_SIZE = 3 * 1;    // RGB 1-byte colour
var CELL_POSE_SIZE = 3 * 8;    // longitude, latitude, altitude as double precision
var CELL_SIZE = CELL_DATA_SIZE + CELL_POSE_SIZE;

var MODEL_DEPTH = 7;


function spherical_to_cartesian(pose) {
    /** Modifies IN PLACE!
        Input: [lon, lat, rad] === Output: [x, y, z] */
    pose[2] = Math.cos(pose[1]) * Math.cos(pose[0]);
    pose[0] = Math.cos(pose[1]) * Math.sin(pose[0]);
    pose[1] = Math.sin(pose[1]);
    return pose;  // not really needed
}

function depth_threshold(distance, spatial_p) {
    /** Returns the necessary depth (i.e. level of detail) of a cell for satisfactory
        visualisation based on distance to it and model parameters
        A cell needs more depth (details/points) if it's closer or we are zoomed
        in with a big scale (i.e. looking at a statue, not at a mountain)
     */
     var upper_bound = spatial_p - MODEL_DEPTH - 2;

     // last term can be adjusted to control the details (values in [9.3, 9.7]):
     // bigger => more detail => more recursion => more data
     var normal = Math.log(EARTH_RADIUS/2 / (distance * 30)) / Math.LN2 + 9.3;

     return normal < 5 ? 5 : (normal > upper_bound ? upper_bound : normal);
}

function distance_threshold(altitude) {
    /** Returns threshold above which recursion stops */
    var normal = altitude / EARTH_RADIUS - 1;
    // threshold magic:
    return (altitude * (1 - 0.75 * Math.exp(-2 * Math.PI * normal * normal)));
}

function distance(pose_A, pose_B, in_cartesian) {
    /**  Calculates cartesian distance between the given poses.
    These can be specified either as polar or cartesian coords, as indicated by
    `in_cartesian` flag */

    var diff;
    if (! in_cartesian) {
        pose_A = spherical_to_cartesian(pose_A.slice());
        pose_B = spherical_to_cartesian(pose_B.slice());
        diff   = pose_A;
    }
    else
        diff = pose_A.slice(); // avoid modifying original

    // compute difference
    diff[0] -= pose_B[0];
    diff[1] -= pose_B[1];
    diff[2] -= pose_B[2];

    // distance is norm of difference
    return Math.sqrt(diff[0]*diff[0] + diff[1]*diff[1] + diff[2]*diff[2]);
}



// addresses with size smaller than this are always fully generated
var CONDITIONAL_RECURSION_IDX = 3;

function fill_viewable(model, addr, idx, cell) {
    /** Generate the cells that can be seen from the current model.pose and
    model.time and save them in model.new_addrs.

    This works recursively, starting from an empty address. The current state
    is kept in `addr` and `idx` points to the `addr` position that is currently
    being iterated.

    If `cell` is given, it is the cell data associated with the current `addr`.
    If this is empty, then we can stop the recursion, as all daughter addresses
    will be empty.

    @model: { cells: [Cell], time, pose: [lon, lat, alt], spatial_param, time_param }
    */
    // check for existence ('null' or 'undefined', hence only '==')
    if (model.pose == undefined)
        throw "Model doesn't have a pose";
    if (model.spatial_param == undefined)
        throw "Model doesn't define spatial indexation parameter";
    if (model.cells == undefined)
        throw "Model doesn't store existing cells";

    // if we arrived from checking a daughter cell which has no data under it
    // then there is no need to further generate
    if (cell && cell.size === 0)
        return;

    // we will generate cells based on their addresses
    // we start with an empty one

    // iterate through all the possible digits that can appear at `idx`
    var max_digit = addr.max_digit(idx);
    for (var digit = 0; digit <= max_digit; ++digit) { // CAN BE EQUAL!!
        addr.digits[idx] = digit;
        addr.size = idx;
        if (idx > CONDITIONAL_RECURSION_IDX) {
            // only generate cells in the close vecinity:
            // TODO: shift to get distance to cell's center
            var dist = distance(addr.get_pose(), model.pose, false); // in polar
            if (dist >= distance_threshold(model.pose[2]))
                continue;

            // check if cell has enough depth (i.e. detailed enough):
            if (Math.abs(depth_threshold(dist, model.spatial_param) - idx) < 1) {
                // OK, has enough depth, add this cell

                // TODO: check maximum number of new cells
                addr.depth = MODEL_DEPTH;
                if (model.cells[addr] == undefined) { // it's a new one
                    // Add it to the model
                    // TODO: memory consideration -- Cell is quite big as of now
                    //          what if you store just True and call `query` which
                    //          will `update` the view anyways, without storing the Cell
                    model.cells[addr] = Cell(addr);
                    model.cells[addr].query(update);
                }
            }
            else if (idx + MODEL_DEPTH + 2 < model.spatial_param) {
                /* needs further depth expansion
                   check if there's any data below so that we don't expand into
                   an array of cells with no data */

                // since the `query` is async, we can't block here. Instead, we
                // set the callback to this function with prepopulated parameters
                // i.e. as if the recursion continued.
                // The `query` will populate the remainig `cell` param
                var continuation_function = fill_viewable.bind(this, model, addr.clone(), idx + 1)

                addr.depth = 0;
                var test_cell = new Cell(addr);
                test_cell.query(continuation_function);
            }

        }
        else { // Unconditional recursion
            fill_viewable(model, addr, idx + 1);
        }
    }
}


function Cell(addr) {
    // keep reference to itself to be accessed from private functions
    var self = this;

    // forward declarations
    if (typeof addr === "string" || addr instanceof String)
        self.addr = new Address(addr);
    else if (addr instanceof Address)
        self.addr = addr.clone();
    else
        throw "Cannot construct Cell from " + typeof addr;

    self.edge      = null;
    self.callback  = null;
    self.geometry  = null;
    self.colors    = null;
    self.positions = null;
    self.size      = 0;

    var socket = null, num_messages = 0;  // for the network interface

    self.query = function(callback) {
        connect();  // falls through auth -> send -> receive
        if (callback)
            self.callback = callback;
    }

    self.get_geometry = function() {
        if (self.geometry)
            return self.geometry
        if (! self.positions || ! self.colors)
            throw "Cannot construct geometry before querying"

        self.geometry = new THREE.BufferGeometry();
        self.geometry.addAttribute('position',
                        new THREE.BufferAttribute(self.positions, 3));
        self.geometry.addAttribute('color'   ,
                        new THREE.BufferAttribute(self.colors   , 3, true)); // true -- normalise
        return self.geometry;
    }

    // === NETWORKING =========================================================
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
        self.size = Math.floor(dv.byteLength / CELL_SIZE);

        self.positions = new Float32Array(3 * self.size);
        self.colors    = new Uint8Array(3 * self.size);
        var positions = self.positions,
            colors    = self.colors;

        for (var curr_pt = 0; curr_pt < self.size; curr_pt++) {
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
            pose[0] = EARTH_RADIUS * (pose[0]);// - self.edge[0]);
            pose[1] = EARTH_RADIUS * (pose[1]);// - self.edge[1]);
            pose[2] = EARTH_RADIUS * (pose[2]);// - self.edge[2]);

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

        console.timeEnd("constructing");
        socket = null;   // dispose

        // finished, use callback
        if (self.callback)
            self.callback(self);
    }

    // === END NETWORKING =========================================================

    return self;
}

