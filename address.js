"use strict";

/* the range of some dimensions is smaller, so their address space is scaled accordingly.
 * these variables define how many digits should be be skipped for each */
var LE_ADDRESS_SYNP =  1;  // latitude (polar)
var LE_ADDRESS_SYNA = 10;  // altitude (radial)
var LE_USE_BASE     =  8;

/* WGS84 ellipsoid parameters */
var LE_ADDRESS_WGSA = 6378137.0;
var LE_ADDRESS_WGSF = 298.257223563;

var EARTH_RADIUS = LE_ADDRESS_WGSA;

/* ellipsoidal coordinates boundaries */
var LE_ADDRESS_MINL = - Math.PI;
var LE_ADDRESS_MAXL = + Math.PI;
var LE_ADDRESS_MINA = - Math.PI / 2.0;
var LE_ADDRESS_MAXA = + Math.PI / 2.0;
var LE_ADDRESS_MINH = - ( Math.PI * LE_ADDRESS_WGSA ) / 1024.0;
var LE_ADDRESS_MAXH = + ( Math.PI * LE_ADDRESS_WGSA ) / 1024.0;

/* ellipsoidal coordinates ranges */
var LE_ADDRESS_RANL = LE_ADDRESS_MAXL - LE_ADDRESS_MINL;
var LE_ADDRESS_RANA = LE_ADDRESS_MAXA - LE_ADDRESS_MINA;
var LE_ADDRESS_RANH = LE_ADDRESS_MAXH - LE_ADDRESS_MINH;


function num2bytes(num) {
    /* JS does bit shifting on 32 bits :(
    This function does it manually for numbers up to 40 bits
    which should be enough for our purposes
    */
    if (Math.abs(num) >= 2**40)
        Util.Warn("Unsafe integer, will have wrong result");

    var bytes = [];
    // do the 'unsafe' part first (> 32-bit)
    if (num >= 0)
        bytes[5] = bytes[6] = bytes[7] = 0;
    else
        bytes[5] = bytes[6] = bytes[7] = 0xFF; // negative, use 2s complement

    // extract the fifth byte via simulated shift
    bytes[4] = Math.floor(num / 2**32) & 0xFF;

    // do the safe part
    for (var i = 0; i < 4; ++i) {
        bytes[i] = num & 0xFF;
        num = num >> 8;
    }

    return bytes;
}

function Address(addrStr) {
    // fields
    this.mode = this.depth = this.time_1 = this.time_2 = 0;
    this.digits = [];

    // construct from string
    if (addrStr) {
        var parts = addrStr.split('/');
        // NOTE: the digits can be missing, i.e. "/3/-1,95048640//0" is valid
        if (parts.length != 5 || parts[0] || !parts[1] || !parts[2] || !parts[4])
            throw("Invalid address");

        this.mode   = parseInt(parts[1]);
        this.depth  = parseInt(parts[3]);

        var times   = parts[2].split(',').map(Number);
        this.time_1 = times[1];
        this.time_2 = times[2];

        this.digits = parts[3].split('').map(Number);
    }
}


Object.defineProperties(Address.prototype, {
    'size': {
        set: function() { Util.Warn("Ignoring assignment to address size."); },
        get: function() { return this.digits.length; }
    },

    'pose': {
        set: function() { Util.Warn("Ignoring assignment to address pose."); },
        get: function() {
            /** Extracts the pose at this address, in polar coordinates.
                This works by reconstructing the three float64 numbers from the bits of `digits`
             */

            var pose = [0.0, 0.0, 0.0];  // [lon, lat, rad]
            var bitp = [1.0, 1.0, 1.0];  // position of the bit being set (as a bit in the mantissa)
            var size = this.size;
            for (var i = 0; i < size; ++i) {
                // extract and accumulate longitude information from this digit
                bitp[0] *= 0.5;                        // advance the bit being set
                pose[0] +=  (this.digits[i] & 0x01      ) * bitp[0];  // set that bit

                if (i < LE_ADDRESS_SYNP) continue;     // skip unused dimension
                bitp[1] *= 0.5;
                pose[1] += ((this.digits[i] & 0x02) >> 1) * bitp[1];

                if (i < LE_ADDRESS_SYNA) continue;     // skip unused dimension
                bitp[2] *= 0.5;
                pose[2] += ((this.digits[i] & 0x04) >> 2) * bitp[2];
            }

            // denormalise the coordinates
            pose[0] = LE_ADDRESS_MINL + pose[0] * LE_ADDRESS_RANL;
            pose[1] = LE_ADDRESS_MINA + pose[1] * LE_ADDRESS_RANA;
            pose[2] = LE_ADDRESS_MINH + pose[2] * LE_ADDRESS_RANH;

            return pose;
        }
    }
});

Address.prototype.max_digit = function(idx) {
    /*  Returns 1 + the maximum digit that can be allowed at the given index.
        This is variable because some dimensions have larger ranges
        NOTE: this is 1 + max to be used in `for` condition with "<" rather than "<="
    */
    if (idx < LE_ADDRESS_SYNP)  // can only cut in longitude -> base 2
        return LE_USE_BASE >> 2;
    if (idx < LE_ADDRESS_SYNA)  // can only cut in (lon,lat) -> base 4
        return LE_USE_BASE >> 1;
    return LE_USE_BASE;         // can cut all (lon,lat,alt) -> base 8
};

// STATIC datatype size in bytes (LE_BUFFER_ADDR)
Address.DIGITS_SIZE  = 40;
Address.TIMES_SIZE   = 2 * 8;
Address.PROP_SIZE    = 3 * 1;
Address.BUFFER_SIZE  = Address.DIGITS_SIZE + Address.TIMES_SIZE + Address.PROP_SIZE;

Address.TIMES_OFFSET = Address.DIGITS_SIZE;
Address.SIZE_OFFSET  = Address.TIMES_OFFSET + Address.TIMES_SIZE;
Address.MODE_OFFSET  = Address.SIZE_OFFSET  + 1;
Address.DEPTH_OFFSET = Address.MODE_OFFSET  + 1;



// STATIC method returning a new address from bytes
Address.from_bytes = function(bytes) {
    var addr = new Address;
    var dv = new DataView(new Uint8Array(bytes).buffer);

    // extract properties -- size, mode, depth
    addr.depth = dv.getUint8(Address.DEPTH_OFFSET);
    addr.mode  = dv.getUint8(Address.MODE_OFFSET);
    var size   = dv.getUint8(Address.SIZE_OFFSET);  // can't set it

    // extract digits
    while (size > 0)
        addr.digits[--size] = dv.getUint8(size);

    // extract times -- Need 2 int32 for each of them -- possibly lossy
    var high_bytes, low_bytes;
    high_bytes  = dv.getInt32(Address.TIMES_OFFSET);
    low_bytes   = dv.getInt32(Address.TIMES_OFFSET + 4);
    addr.time_1 = high_bytes * 4294967296.0 + low_bytes;

    high_bytes  = dv.getInt32(Address.TIMES_OFFSET + 8);
    high_bytes  = dv.getInt32(Address.TIMES_OFFSET + 12);
    addr.time_2 = high_bytes * 4294967296.0 + low_bytes;

    return addr;
}


Address.prototype.to_bytes = function() {
    /** Converts this address to a stream of bytes to be sent on the network */
    var bytes = this.digits.slice();                // each digit is a byte
    bytes = bytes.concat(num2bytes(this.time_1));   // 8 bytes
    bytes = bytes.concat(num2bytes(this.time_2));   // 8 bytes
    bytes.push(this.size, this.mode, this.depth);   // 1 byte each
    // complete the buffer with zeros
    for (var i = bytes.length; i < Address.BUFFER_SIZE; ++i)
        bytes[i] = 0;
    return bytes;
}


Address.prototype.clone = function() {
    var other    = new Address();
    other.mode   = this.mode;
    other.depth  = this.depth;
    other.time_1 = this.time_1;
    other.time_2 = this.time_2;
    var size     = this.size;
    for (var i = 0; i < size; ++i)
        other.digits[i] = this.digits[i];
    return other;
};

Address.prototype.toString = function() {
    return "/" + this.mode
        +  "/" + this.time_1 + "," + this.time_2
        +  "/" + this.digits.join("")
        +  "/" + this.depth;
};




