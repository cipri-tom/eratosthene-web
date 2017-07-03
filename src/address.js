import { num2bytes } from './serial';
/* global Util */

/* the range of some dimensions is smaller, so their address space is scaled accordingly.
 * these variables define how many digits should be be skipped for each */
const LE_ADDRESS_SYNP =  1;  // latitude (polar)
const LE_ADDRESS_SYNA = 10;  // altitude (radial)
const LE_USE_BASE     =  8;

/* WGS84 ellipsoid parameters */
const LE_ADDRESS_WGSA = 6378137.0;
const LE_ADDRESS_WGSF = 298.257223563;

export const EARTH_RADIUS = LE_ADDRESS_WGSA;

/* ellipsoidal coordinates boundaries */
const LE_ADDRESS_MINL = -Math.PI;
const LE_ADDRESS_MAXL = +Math.PI;
const LE_ADDRESS_MINA = -Math.PI / 2.0;
const LE_ADDRESS_MAXA = +Math.PI / 2.0;
const LE_ADDRESS_MINH = -(Math.PI * LE_ADDRESS_WGSA) / 1024.0;
const LE_ADDRESS_MAXH = +(Math.PI * LE_ADDRESS_WGSA) / 1024.0;

/* ellipsoidal coordinates ranges */
const LE_ADDRESS_RANL = LE_ADDRESS_MAXL - LE_ADDRESS_MINL;
const LE_ADDRESS_RANA = LE_ADDRESS_MAXA - LE_ADDRESS_MINA;
const LE_ADDRESS_RANH = LE_ADDRESS_MAXH - LE_ADDRESS_MINH;

export default function Address(addrStr) {
  // fields
  this.mode = this.depth = this.time_0 = this.time_1 = 0;
  this.digits = [];

  // construct from string -- "/mode/t0,t1/d1d2d3...dn/span"
  if (addrStr) {
    const parts = addrStr.split('/');
    // NOTE: the digits can be missing, i.e. "/3/-1,95048640//0" is valid
    if (parts.length !== 5 || parts[0] || !parts[1] || !parts[2] || !parts[4]) {
      throw new Error(`Invalid address ${addrStr}`);
    }

    this.mode   = parseInt(parts[1], 10);
    this.depth  = parseInt(parts[4], 10);
    this.times  = parts[2].split(',').map(Number);
    this.digits = parts[3].split('').map(Number);
  }
}


Object.defineProperties(Address.prototype, {
  size: {
    set() { Util.Warn('Ignoring assignment to address size.'); },
    get() { return this.digits.length; },
  },

  pose: {
    set() { Util.Warn('Ignoring assignment to address pose.'); },
    /** Extracts the pose at this address, in polar coordinates.
     This works by reconstructing the three float64 numbers from the bits of `digits` */
    get() {
      const pose = [0.0, 0.0, 0.0];  // [lon, lat, rad]
      const bitp = [1.0, 1.0, 1.0];  // position of the bit being set (as a bit in the mantissa)
      const size = this.size;
      for (let i = 0; i < size; ++i) {
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
    },
  },
});

/**  Returns 1 + the maximum digit that can be allowed at the given index.
 This is variable because some dimensions have larger ranges
 NOTE: adds 1 because it should be used as `for` condition (where "<" is nicer than "<=")
 */
Address.maxDigit = function maxDigit(idx) {
  if (idx < LE_ADDRESS_SYNP) return LE_USE_BASE >> 2; // can only cut in longitude -> base 2
  if (idx < LE_ADDRESS_SYNA) return LE_USE_BASE >> 1; // can only cut in (lon,lat) -> base 4
  return LE_USE_BASE;                                 // can cut all (lon,lat,alt) -> base 8
};

Address.TIME_SIZE   = 2 * 8;   //  2 * uint64 times
Address.DESC_SIZE   = 3;       // mode: uint8; digits_size: uint8; depth: uint8;
Address.DIGITS_SIZE = 40;      // 40 * uint8  digits (LE_BUFFER_ADDR)
Address.BUFFER_SIZE = Address.TIME_SIZE + Address.DESC_SIZE + Address.DIGITS_SIZE;

// the order in which they are encountered in the buffer:
//      times; size; mode; span; digits
Address.TIME_OFFSET   = 0;
Address.SIZE_OFFSET   = Address.TIME_OFFSET + Address.TIME_SIZE;
Address.MODE_OFFSET   = Address.SIZE_OFFSET + 8;  // addressSize: uint64 -> 8 bytes
Address.SPAN_OFFSET   = Address.MODE_OFFSET + 1;  // addressMode: uint8  -> 1 byte
Address.DIGITS_OFFSET = Address.SPAN_OFFSET + 1;  // addressSpan: uint8  -> 1 byte

/** CLASS method returning the specified time from a DataView object */
Address.extractTime = function extractTime(dv, which = 0, offset = 0) {
  // Each time is uint64 so we need 2 int32 => possibly lossy
  const highBytes = dv.getInt32(offset + Address.TIME_OFFSET + which * 8    , true);
  const lowBytes  = dv.getInt32(offset + Address.TIME_OFFSET + which * 8 + 4, true);
  return highBytes * 4294967296.0 + lowBytes;
};


/** CLASS method returning a new address from bytes */
Address.fromBytes = function addrFromBytes(bytes) {
    let addr = new Address;
    var dv   = new DataView(new Uint8Array(bytes).buffer);

    // extract properties -- size, mode, depth
    addr.depth = dv.getUint8(Address.SPAN_OFFSET);
    addr.mode  = dv.getUint8(Address.MODE_OFFSET);
    var size   = dv.getUint8(Address.SIZE_OFFSET);  // can't set it

    // extract digits
    while (size > 0)
        addr.digits[--size] = dv.getUint8(size);

    // extract times
    addr.time_0 = this.extractTime(dv, 0);
    addr.time_1 = this.extractTime(dv, 1);

    return addr;
};


Address.prototype.to_bytes = function() {
    /** Converts this address to a stream of bytes to be sent on the network */
    var bytes = this.digits.slice();                // each digit is a byte
    // complete the rest of the digits with zeros
    for (var i = bytes.length; i < Address.DIGITS_SIZE; ++i)
        bytes[i] = 0;

    bytes = bytes.concat(num2bytes(this.time_0));   // 8 bytes
    bytes = bytes.concat(num2bytes(this.time_1));   // 8 bytes
    bytes.push(this.size, this.mode, this.depth);   // 1 byte each
    return bytes;
}

Address.prototype.clone = function cloneAddr() {
  const other  = new Address();
  other.mode   = this.mode;
  other.depth  = this.depth;
  other.time_0 = this.time_0;
  other.time_1 = this.time_1;
  const size   = this.size;
  for (let i = 0; i < size; ++i) {
    other.digits[i] = this.digits[i];
  }
  return other;
};

Address.prototype.toString = function addrToString() {
  /* eslint prefer-template: off */
  return '/' + this.mode
      +  '/' + this.time_0 + ',' + this.time_1
      +  '/' + this.digits.join('')
      +  '/' + this.depth;
};
