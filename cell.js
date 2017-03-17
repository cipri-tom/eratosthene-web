"use strict";

// constants
var HOST = "ws://127.0.0.1:43427"

var CELL_DATA_SIZE = 3 * 1;    // RGB 1-byte colour
var CELL_POSE_SIZE = 3 * 8;    // longitude, latitude, altitude as double precision
var CELL_SIZE = CELL_DATA_SIZE + CELL_POSE_SIZE;

var MODEL_DEPTH = 7;


function spherical_to_cartesian(pose) {
    /** Input : [lon, lat, rad]
        Output: [x, y, z]
    */
    var cart = [0, 0, 0];
    cart[0] = pose[2] * Math.cos(pose[1]) * Math.sin(pose[0]); // x
    cart[1] = pose[2] * Math.sin(pose[1]);                     // y
    cart[2] = pose[2] * Math.cos(pose[1]) * Math.cos(pose[0]); // z
    return cart;
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

function distance(addr, view_pose) {
    /**  Specialised distance function between viewpoint and address */

    // get pose at address and restore its altitude
    var cell_pose = addr.pose;
    cell_pose[2] += EARTH_RADIUS;

    // since pose is at the "edge" shift to get distance to the cell's centre
    var scale = 1 << (addr.size + 1);
    var shift = LE_GEODESY_LRAN / scale;
    cell_pose[0] += shift;
    cell_pose[1] += shift;
    cell_pose[2] += 2 * Math.PI * EARTH_RADIUS / scale;

    // convert both to cartesian
    cell_pose = spherical_to_cartesian(cell_pose);
    view_pose = spherical_to_cartesian(view_pose);

    // compute difference (reusing the same array)
    cell_pose[0] -= view_pose[0];
    cell_pose[1] -= view_pose[1];
    cell_pose[2] -= view_pose[2];

    // distance is norm of difference
    return Math.sqrt(cell_pose[0]*cell_pose[0] + cell_pose[1]*cell_pose[1] + cell_pose[2]*cell_pose[2]);
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
    if (cell && cell.size === 0) {
        // but keep track that we already checked this
        model.cells[cell.addr] = true;
        return;
    }

    // we will generate cells based on their addresses
    // we start with an empty one

    // create new slot
    addr.digits.push(0);
    if (addr.size !== idx + 1)
        Util.Warn("Inconsistent address generation");

    // iterate through all the possible digits that can appear at `idx`
    var max_digit = addr.max_digit(idx);
    for (var digit = 0; digit < max_digit; ++digit) { // can NOT be equal !!
        // update address with this digit
        addr.digits[idx] = digit;

        // ignore if we have seen it before (including empty ones)
        if (model.cells[addr] != undefined)
            continue;

        if (idx > CONDITIONAL_RECURSION_IDX) {
            // TODO: already check if it's in the model and skip if yes
            //       this also means that you can set empty addresses to avoid
            //       further querying

            // get distance from viewpoint to this addr
            var dist = distance(addr, model.pose);

            // skip cells that are too far away:
            if (dist >= distance_threshold(model.pose[2]))
                continue;

            // check if cell has enough depth (i.e. detailed enough):
            if (Math.abs(depth_threshold(dist, model.spatial_param) - idx) < 1) {
                // OK, has enough depth, we can process it

                // set the correct depth
                addr.depth = MODEL_DEPTH;

                // here we have to check again, because we cannot set the "top level"
                // cell as seen (depth = 0), we need with this specific depth
                // if (model.cells[addr] == undefined) {
                    // set as seen
                    // TODO: check maximum number of new cells
                    model.cells[addr] = true;

                    // query
                    new Cell(addr).query(update);
                // }

            }
            else if (idx + MODEL_DEPTH + 2 < model.spatial_param) {
                /* needs further depth expansion
                   check if there's any data below so that we don't expand into
                   an array of cells with no data */

                // since the `query` is async, we can't block here. Instead, we
                // set the callback to this same function but with prepopulated
                // parameters i.e. as if the recursion continued.
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

    // remove this slot
    addr.digits.pop();
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
        // Util.Info(`Receiving auth: ${socket.rQlen()} bytes`);
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
        Util.Info(`received ${socket.rQlen()} bytes in ${num_messages} messages`);

        // console.time("constructing");
        // the edge is defined to be at 0 altitude (i.e. EARTH_RADIUS)
        self.edge = self.addr.pose;
        self.edge[2] = EARTH_RADIUS;
        self.edge = spherical_to_cartesian(self.edge);

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

            // extract vertices -- lon, lat, alt
            pose[0] = dv.getFloat64(offset     , true);  // true == little endian
            pose[1] = dv.getFloat64(offset + 8 , true);
            pose[2] = dv.getFloat64(offset + 16, true);
            offset += CELL_POSE_SIZE;

            // only the meaningful part of altitude is received, so we need to restore the rest
            pose[2] += EARTH_RADIUS;

            // convert and translate relative to edge
            pose = spherical_to_cartesian(pose);
            // pose[0] = pose[0] - self.edge[0];
            // pose[1] = pose[1] - self.edge[1];
            // pose[2] = pose[2] - self.edge[2];

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

        // console.timeEnd("constructing");
        socket = null;   // dispose

        // finished, use callback
        if (self.callback)
            self.callback(self);
    }

    // === END NETWORKING =========================================================

    return self;
}

