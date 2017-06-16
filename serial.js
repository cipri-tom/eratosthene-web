'use strict';

/* global Util Address */


/** Similar to the default getUint32 but it is always in little endian */
DataView.prototype.getUint32LE = function(offset) {
  return this.getUint32(offset, true);
};

DataView.prototype.getUint64 = function() {

}

/** Expands `num` into a list of bytes */
function num2bytes(num) {
  /* JS does bit shifting on 32 bits :(
  This function does it manually for numbers up to 40 bits
  which should be enough for our purposes
  */
  if (Math.abs(num) >= 2 ** 40) {
    Util.Warn('Unsafe integer, will have wrong result');
  }

  const bytes = [];
  // do the 'unsafe' part first (> 32-bit)
  if (num >= 0) {
    bytes[5] = bytes[6] = bytes[7] = 0;
  } else {
    bytes[5] = bytes[6] = bytes[7] = 0xFF;  // negative, use 2s complement
  }

  // extract the fifth byte via simulated shift
  bytes[4] = Math.floor(num / (2 ** 32)) & 0xFF;

  // do the safe part
  for (let i = 0; i < 4; ++i) {
    bytes[i] = num & 0xFF;
    num >>= 8; /* eslint no-param-reassign: "off"  */ // primitive is safe to reassign
  }

  return bytes;
}


/** Lowest level interface, right above the network socket, to serialise data to/from the server
 * This is always :
 * | uint64 vsize | uint64 csize | uint8[] bytes |
 * @constructor
 *
 * @param (string) type: 'AGREE', 'ADDR_SINGLE', 'ADDR_MULTI', 'CELL'
 */
function ErArray(size) {
  this.length = 0;
  if (size === 'AGREE') {
    this.bytes = new Uint8Array([0xff, 0xff, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00]);
  }
}

ErArray.ARRAY_SIZE_STEP = 1048576;  // increase in 1 Mb steps
ErArray.ARRAY_HEADER_SIZES = 2 * 8; // 2 * uint64 (vsize, csize)
ErArray.ARRAY_HEADER_MODE = 1;     // uint8 for mode
ErArray.ARRAY_HEADER = ErArray.ARRAY_HEADER_SIZES + ErArray.ARRAY_HEADER_MODE;


/** constants for network */
const NETWORK = {
  SCHEMA: 'ws://',  // change to wss for secure protocol (needs TLS server)
  IP: '127.0.0.1',
  PORT: 11027,
  get HOST() { return `${this.SCHEMA + this.IP}:${this.PORT}`; },

  MODE: { AUTH: 0x01 },

  connect() {
    const socket = new WebSocket(this.HOST, 'binary');

    socket.onopen = function send_auth() {

    };

    socket.onmessage = function validate_auth(msg) {
      console.log(msg);
      // TODO
    };
  },
};

// Singleton socket -- One per client
let GLOBAL_SOCKET = null;
function connect() {
  if (GLOBAL_SOCKET) throw new Error('Cannot connect twice');

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(NETWORK.HOST, 'binary');
    socket.binaryType = 'arraybuffer';

    // TODO: check binary is supported

    socket.onerror = () => { Util.Error('Socket had an error'); };
    socket.onclose = () => {
      GLOBAL_SOCKET = null;
      throw new Error('Connection to server failed / closed');
    };

    socket.onopen = function sendAuth() {
      // construct agreement object: 0xffff0000ffff0000
      const buf = new ArrayBuffer(ErArray.ARRAY_HEADER + 8);
      const dv  = new DataView(buf);
      let offset = 0;

      // setup array header -- vsize; value "8" written over 8 bytes
      const vsize = 8;  // sizeof agreement data
      dv.setUint32(offset, vsize, true); offset += 8;  // Uint32 suffices, the next 4 bytes are 0 anyway

      // setup array header -- csize=0; buffer is zeros by default, so we just skip
      offset += 8;

      // setup array header -- mode, 1 byte
      dv.setUint8 (offset, NETWORK.MODE.AUTH); offset += 1;

      // set agreement data: 0xffff0000ffff0000              -- total 8 bytes
      dv.setUint32(offset, 0xffff0000, true);  offset += 4;  // first 4 bytes
      dv.setUint32(offset, 0xffff0000, true);                // next  4 bytes

      socket.send(dv.buffer);
    };

    socket.onmessage = function validateAuth(msg) {
      const dv = new DataView(msg.data);
      let offset = 0;
      // extract array header
      const vsize  = dv.getUint32LE(offset); offset += 8;  // vsize is uint64, only the first 4 are relevant
      const csize  = dv.getUint32LE(offset); offset += 8;  // same as vsize
      const mode   = dv.getUint8   (offset); offset += 1;

      if (vsize !== 3 * 8 || csize !== 0) {
        reject(new Error('Incorrect data in server agreement')); // the reply should have three size_t
      }

      // extract the reply: agree, spaceParam, timeParam
      const agreeL = dv.getUint32LE(offset), agreeH = dv.getUint32LE(offset + 4); offset += 8;
      const spaceL = dv.getUint32LE(offset), spaceH = dv.getUint32LE(offset + 4); offset += 8;
      const  timeL = dv.getUint32LE(offset),  timeH = dv.getUint32LE(offset + 4);

      if (mode !== NETWORK.MODE.AUTH || agreeL !== 0x0000ffff || agreeH !== 0x0000ffff) {
        reject(new Error('Server agreement failed'));
      }

      if (spaceH !== 0 || timeH !== 0) {
        reject(new Error('Server parameters bigger than expected'));
      }

      // all is well, setup the next messages -- nothing
      socket.onmessage = () => { throw new Error('Unrequested message from server'); };
      GLOBAL_SOCKET = socket;

      resolve({ socket, spaceParam: spaceL, timeParam: timeL });
    };
  });
}
