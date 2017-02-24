"use strict";

var ADDR_NET_BUFFER_SIZE = 88; // default length of address buffer (LE_NETWORK_SB_ADDR)


/* the range of some dimensions is smaller, so their address space is scaled accordingly.
 * these variables define how many digits should be be skipped for each */
var LE_GEODESY_ASYP =  1;  // latitude (polar)
var LE_GEODESY_ASYA = 10;  // altitude (radial)
var LE_USE_BASE     =  8;

/* WGS84 ellipsoid parameters */
var LE_GEODESY_WGS84_A = 6378137.0;
var LE_GEODESY_WGS84_F = 298.257223563;

var EARTH_RADIUS = LE_GEODESY_WGS84_A;

/* ellispoidal coordinates boundaries */
var LE_GEODESY_LMIN = - Math.PI;
var LE_GEODESY_LMAX = + Math.PI;
var LE_GEODESY_AMIN = - Math.PI / 2.0;
var LE_GEODESY_AMAX = + Math.PI / 2.0;
var LE_GEODESY_HMIN = - ( Math.PI * LE_GEODESY_WGS84_A ) / 1024.0;
var LE_GEODESY_HMAX = + ( Math.PI * LE_GEODESY_WGS84_A ) / 1024.0;

/* ellipsoidal coordinates ranges */
var LE_GEODESY_LRAN = LE_GEODESY_LMAX - LE_GEODESY_LMIN;
var LE_GEODESY_ARAN = LE_GEODESY_AMAX - LE_GEODESY_AMIN;
var LE_GEODESY_HRAN = LE_GEODESY_HMAX - LE_GEODESY_HMIN;


function num2bytes(num) {
    var bytes = [];
    for (var i = 0; i < 8; ++i) {
        bytes[i] = num & 0xFF;
        num = num >> 8;
    }
    return bytes;
}

function Address(addrStr) {
    // fields
    this.time = this.depth = 0;
    this.digits = [];

    // construct from string
    if (addrStr) {
        var parts = addrStr.split('/');
        // NOTE: the digits can be missing, i.e. "/950486400//0" is valid
        if (parts.length != 4 || parts[0] || !parts[1] || !parts[3])
            throw("Invalid address");

        this.time   = parseInt(parts[1]);
        this.depth  = parseInt(parts[3]);
        this.digits = parts[2].split('').map(Number);
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

                if (i < LE_GEODESY_ASYP) continue;     // skip unused dimension
                bitp[1] *= 0.5;
                pose[1] += ((this.digits[i] & 0x02) >> 1) * bitp[1];

                if (i < LE_GEODESY_ASYA) continue;     // skip unused dimension
                bitp[2] *= 0.5;
                pose[2] += ((this.digits[i] & 0x04) >> 2) * bitp[2];
            }

            // denormalise the coordinates
            pose[0] = LE_GEODESY_LMIN + pose[0] * LE_GEODESY_LRAN;
            pose[1] = LE_GEODESY_AMIN + pose[1] * LE_GEODESY_ARAN;
            pose[2] = LE_GEODESY_HMIN + pose[2] * LE_GEODESY_HRAN;

            return pose;
        }
    }
});

Address.prototype.max_digit = function(idx) {
    /*  Returns 1 + the maximum digit that can be allowed at the given index.
        This is variable because some dimensions have larger ranges
        NOTE: this is 1 + max to be used in `for` condition with "<" rather than "<="
    */
    if (idx < LE_GEODESY_ASYP)  // can only cut in longitude -> base 2
        return LE_USE_BASE >> 2;
    if (idx < LE_GEODESY_ASYA)  // can only cut in (lon,lat) -> base 4
        return LE_USE_BASE >> 1;
    return LE_USE_BASE;         // can cut all (lon,lat,alt) -> base 8
};

Address.prototype.to_bytes = function() {
    /** Converts this address to a stream of bytes to be sent on the network */
    var bytes = [];
    bytes = bytes.concat(num2bytes(this.size));
    bytes = bytes.concat(num2bytes(this.time));
    bytes = bytes.concat(num2bytes(this.depth));
    bytes = bytes.concat(this.digits);
    // complete the buffer with zeros
    for (var i = bytes.length; i < ADDR_NET_BUFFER_SIZE; ++i)
        bytes[i] = 0;
    return bytes;
}

Address.prototype.clone = function() {
    var other    = new Address();
    other.time   = this.time;
    other.depth  = this.depth;
    var size = this.size;
    for (var i = 0; i < size; ++i)
        other.digits[i] = this.digits[i];
    return other;
};

Address.prototype.toString = function() {
    return "/" + this.time + "/" + this.digits.join("") + "/" + this.depth;
};




