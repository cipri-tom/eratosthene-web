import { Vector3 } from '../lib/three.modules';
/* global Util */

/* WGS84 ellipsoid parameters */
const LE_ADDRESS_WGSA = 6378137.0;
const LE_ADDRESS_WGSF = 298.257223563; // eslint-disable-line no-unused-vars

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

export function Address(addrStr) {
  // fields
  this.mode = 0;
  this.span = MAX_SCALE_VALUE;
  this.time = [];
  this.digits = [];

  // construct from string -- "/mode/t0,t1/d1d2d3...dn/span"
  if (addrStr) {
    const parts = addrStr.split('/');
    // NOTE: the digits can be missing, i.e. "/3/-1,95048640//0" is valid
    if (parts.length !== 5 || parts[0] || !parts[1] || !parts[2] || !parts[4]) {
      throw new Error(`Invalid address ${addrStr}`);
    }

    this.mode = parseInt(parts[1], 10);
    this.span = parseInt(parts[4], 10);
    this.time = parts[2].split(',').map(Number);
    this.digits = parts[3].split('').map(Number);
  }
}


/** Maximum value for a scale */
const MAX_SCALE_VALUE  =  7;

/** This parameter defines at what scale we start subdividing the latitude,
 * because its range is smaller than that of longitude */
const LE_ADDRESS_SYNP =  1;  // latitude (polar)

/** This parameter defines at what scale we start subdividing the altitude,
 * because its range is smaller than that of longitude and latitude */
const LE_ADDRESS_SYNA = 10;  // altitude (radial)

/**  Returns 1 + the maximum scale that can be allowed at the given index.
 NOTE: adds 1 because it should be used as `for` condition (where `<` is nicer than `<=`) */
Address.maxValue = function addrMaxValue(scale) {
  if (scale < LE_ADDRESS_SYNP) return 1 + (MAX_SCALE_VALUE >> 2); // can only cut in longitude -> base 2
  if (scale < LE_ADDRESS_SYNA) return 1 + (MAX_SCALE_VALUE >> 1); // can only cut in (lon,lat) -> base 4
  return 1 + MAX_SCALE_VALUE;                                     // can cut all (lon,lat,alt) -> base 8
};

Address.TIME_SIZE   = 2 * 8;   //  2 * uint64 time
Address.DESC_SIZE   = 3;       // mode: uint8; digits_size: uint8; span: uint8;
Address.DIGITS_SIZE = 40;      // 40 * uint8  digits (LE_BUFFER_ADDR)
Address.BUFFER_SIZE = Address.TIME_SIZE + Address.DESC_SIZE + Address.DIGITS_SIZE;

// the order in which they are encountered in the buffer:
//      time; size; mode; span; digits
Address.TIME_OFFSET   = 0;
Address.SIZE_OFFSET   = Address.TIME_OFFSET + Address.TIME_SIZE;
Address.MODE_OFFSET   = Address.SIZE_OFFSET + 8;  // addressSize: uint64 -> 8 bytes
Address.SPAN_OFFSET   = Address.MODE_OFFSET + 1;  // addressMode: uint8  -> 1 byte
Address.DIGITS_OFFSET = Address.SPAN_OFFSET + 1;  // addressSpan: uint8  -> 1 byte


/** Converts this address to a stream of bytes to be sent on the network */
Address.prototype.toBytes = function addrToBytes() {
  const addrDv = new DataView(new ArrayBuffer(Address.BUFFER_SIZE));
  let offset = 0;
  addrDv.setInt64LE(offset, this.time[0]);  offset += 8;
  addrDv.setInt64LE(offset, this.time[1]);  offset += 8;
  addrDv.setUint8  (offset, this.size);     offset += 1;
  addrDv.setUint8  (offset, this.mode);     offset += 1;
  addrDv.setUint8  (offset, this.span);     offset += 1;

  const digitsView = new Uint8Array(addrDv.buffer, offset, this.size);
  digitsView.set(this.digits);  // everything up to Address.BUFFER_SIZE remains zero

  return addrDv.buffer;
};

Address.prototype.clone = function cloneAddr() {
  const other = new Address();
  other.mode = this.mode;
  other.span = this.span;
  other.time = this.time.slice();
  for (let i = 0, size = this.size; i < size; ++i) {
    other.digits[i] = this.digits[i];
  }
  return other;
};

Address.prototype.toString = function addrToString() {
  /* eslint prefer-template: off */
  return '/' + this.mode
      +  '/' + this.time[0] + ',' + this.time[1]
      +  '/' + this.digits.join('')
      +  '/' + this.span;
};

Object.defineProperties(Address.prototype, {
  size: {
    set() { Util.Warn('Ignoring assignment to address size.'); },
    get() { return this.digits.length; },
  },

  poseCentre: {
    set() { Util.Warn('Ignoring assignment to address pose.'); },
    /** Extracts the pose at this address, in cartesian coordinates.
     This works by reconstructing the three float64 numbers from the bits of `digits`
     NOTE: altitude is normalised to earth radius
     NOTE: while the address points to the "edge" of a cell, the pose returned is that of the "center" */
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
      pose[0]  = LE_ADDRESS_MINL + pose[0] * LE_ADDRESS_RANL;                     // lon
      pose[1]  = LE_ADDRESS_MINA + pose[1] * LE_ADDRESS_RANA;                     // lat
      pose[2]  = LE_ADDRESS_MINH + pose[2] * LE_ADDRESS_RANH + LE_ADDRESS_WGSA;   // alt (with earth radius)

      // shift to the cell centre (in spherical coords)
      const scale = 1 << (this.size + 1);
      const shift = LE_ADDRESS_RANL / scale;
      pose[0] += shift;
      pose[1] += shift;
      pose[2] += 2 * Math.PI * LE_ADDRESS_WGSA / scale;

      // change to cartesian coordinates
      const cart = [0, 0, 0];
      cart[0] = pose[2] * Math.cos(pose[1]) * Math.sin(pose[0]); // x
      cart[1] = pose[2] * Math.sin(pose[1]);                     // y
      cart[2] = pose[2] * Math.cos(pose[1]) * Math.cos(pose[0]); // z

      return new Vector3(...cart);
    },
  },
});

const EARTH = {
  RADIUS: LE_ADDRESS_WGSA,
  ALTITUDE: { MIN: LE_ADDRESS_WGSA * 0.75, MAX: LE_ADDRESS_WGSA * 3.00 },  // ER_COMMON_ALL, ER_COMMON_ALU
};
export { EARTH, MAX_SCALE_VALUE  };
export default Address;
