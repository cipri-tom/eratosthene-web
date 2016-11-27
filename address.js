"use strict";

var LE_NETWORK_SB_ADDR = 88; // default length of address buffer


/* the range of some dimensions is smaller, so their address space is scaled accordingly.
 * these variables define how many digits should be be skipped for each */
var LE_GEODESY_ASYP =  1;  // latitude (polar)
var LE_GEODESY_ASYA = 10;  // altitude (radial)

/* WGS84 ellipsoid parameters */
var LE_GEODESY_WGS84_A = 6378137.0;
var LE_GEODESY_WGS84_F = 298.257223563;

var EARTH_ALTITUDE = LE_GEODESY_WGS84_A;

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



function Address(addrStr) {
    // keep reference to itself to be accessed from private functions
    var self = this;

    // fields
    self.time = self.depth = self.size = 0;
    self.digits = [];

    // construct from string
    if (addrStr) {
        var parts = addrStr.split('/');
        if (parts.length != 4 || parts[0] || !parts[1] || !parts[2] || !parts[3])
            throw("Invalid address");

        self.time = parseInt(parts[1]);
        self.size = parts[2].length;
        for (var i = 0; i < self.size; ++i)
            self.digits.push(parts[2][i]);
        self.depth = parseInt(parts[3]);
    }

    self.to_bytes = function() {
        var bytes = [];
        bytes = bytes.concat(num2bytes(self.size));
        bytes = bytes.concat(num2bytes(self.time));
        bytes = bytes.concat(num2bytes(self.depth));
        bytes = bytes.concat(self.digits);
        for (var i = bytes.length; i < LE_NETWORK_SB_ADDR; ++i)
            bytes[i] = 0;
        return bytes;
    }

    self.get_pose = function() {
        /** Extracts pose at this address.
            This works by reconstructing the three float64 numbers from the bits of `digits`
         */
        if (self.size === 0)
            throw "Can't get pose from empty address";

        var pose = [0.0, 0.0, 0.0];  // [lon, lat, rad]
        var bitp = [1.0, 1.0, 1.0];  // position of the bit being set
        for (var i = 0; i < self.size; ++i) {
            // extract and accumulate longitude information from this digit
            bitp[0] *= 0.5;                        // advance the bit being set
            pose[0] += (self.digits[i] & 0x01) * bitp[0];  // set that bit

            if (i < LE_GEODESY_ASYP) continue;      // skip unused dimension
            bitp[1] *= 0.5;
            pose[1] += (self.digits[i] & 0x02) * bitp[1];

            if (i < LE_GEODESY_ASYA) continue;      // skip unused dimension
            bitp[2] *= 0.5;
            pose[2] += (self.digits[i] & 0x04) * bitp[2];
        }

        // denormalise the coordinates
        pose[0] = LE_GEODESY_LMIN + pose[0] * LE_GEODESY_LRAN;
        pose[1] = LE_GEODESY_AMIN + pose[1] * LE_GEODESY_ARAN;
        pose[2] = LE_GEODESY_HMIN + pose[2] * LE_GEODESY_HRAN;

        return pose;
    }
}
