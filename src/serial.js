/* global Util */

import { Address } from './address';
import Queue from '../lib/Queue'

/** Similar to the default getUint32 but it is always in little endian */
DataView.prototype.getUint32LE = function dvGetUint32LE(offset) {
  return this.getUint32(offset, true);
};

DataView.prototype.getUint64LE = function dvGetUint64LE(offset) {
  const bytesL = this.getUint32(offset, true);
  const bytesH = this.getUint32(offset + 4, true);
  const result = bytesH * 4294967296.0 + bytesL;
  if (result > Number.MAX_SAFE_INTEGER)
    throw new Error('Cannot extract uint64 safely');
  return result;
};

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
class ErArray {
  constructor(dv, offset) {
    if (dv.byteLength - offset < ErArray.ARRAY_HEADER) throw new Error('Cannot build ErArray: incomplete header');
    this.cLength = dv.getUint64LE(offset);
    this.length = dv.getUint64LE(offset + 8);

    const bytesAvailable = dv.byteLength - offset - ErArray.ARRAY_HEADER;
    if (this.cLength <= bytesAvailable) {
      this.cFilled = this.cLength;
      const cBytes = new Uint8Array(dv.buffer, offset + ErArray.ARRAY_HEADER, this.cLength);
      this.decompress(cBytes);
    } else {
      this.cBytes = new Uint8Array(this.cLength);
      this.cBytes.set(new Uint8Array(dv.buffer, offset + ErArray.ARRAY_HEADER));  // with everything remaining
      this.cFilled = bytesAvailable;
    }
  }

  fill(msg) {
    if (this.isFull) throw new Error('Array already full');
    const newBytes = msg.popBytes(this.cLength - this.cFilled);
    this.cBytes.set(newBytes, this.cFilled);
    this.cFilled += newBytes.length;

    if (this.cFilled === this.cLength) {
      this.bytes = ErArray.decompress(new DataView(this.cBytes.buffer), 0);
      this.isFull = true;
      delete this.cBytes;
      delete this.cFilled;
    }
  }

  isFull() { return this.cFilled === this.cLength; }

  decompress() {

  }

  // isComplete(dv, offset) {
  //   return dv.getUint64LE(offset) <= dv.byteLength - offset - ErArray.ARRAY_HEADER;
  // }
}
Object.defineProperties(ErArray.prototype, {
  compressedLength: {
    get() { return this.cLength + ErArray.ARRAY_HEADER; },
    set() { throw new Error('Cannot set read-only property'); },
  },
});


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
};

class Message {
  constructor(buffer) {
    this.dv = new DataView(buffer);
    this.offset = 0;
  }

  popArray() {
    if (this.offset === this.dv.byteLength) return null;
    const arr = new ErArray(this.dv, this.offset);
    this.offset += arr.cFilled;
    return arr;
  }

  /** Fills remaining bytes in the given array as much as possible */
  fillArray(array) {
    if (array.isFull) throw new Error('Array already full');


    const howMany = Math.min(this.dv.byteLength - this.offset, maxLength);
    const bytes = new Uint8Array(this.dv.buffer, this.offset, length);
    this.offset += howMany;
    return bytes;
  }

  isEmpty() {
    return this.offset === this.dv.byteLength;
  }
}

Object.defineProperties(Message.prototype, {
  length: {
    get() { return this.dv.byteLength - this.offset; },
    set() { throw new Error('Cannot set read-only length of Message'); },
  },
});


class Serializer {
  constructor() {
    this.socket = null;
    this.dataReceiverCb = null;
    this.array = null;
  }

  /** Establishes an authenticated connection to the server and sets up further message exchanges */
  connect(dataReceiverCb) {
    if (this.socket)          throw new Error('Cannot connect twice');
    if (!this.dataReceiverCb) throw new Error('No data receiver given');

    this.dataReceiverCb = dataReceiverCb;

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(NETWORK.HOST, 'binary');
      socket.binaryType = 'arraybuffer';

      // TODO: check binary is supported

      socket.onerror = () => { Util.Error('Socket had an error'); };
      socket.onclose = () => {
        this.socket = null;
        throw new Error('Connection to server failed / closed');
      };

      socket.onopen = function sendAuth() {
        // construct agreement object: 0xffff0000ffff0000  -- 8 bytes
        const buf = new ArrayBuffer(ErArray.ARRAY_HEADER + 8);
        const dv  = new DataView(buf);
        let offset = 0;

        // setup array header -- vsize; value "8" written over 8 bytes
        const vsize = 8;  // sizeof agreement data
        dv.setUint32(offset, vsize, true);       offset += 8;  // Uint32 suffices, the next 4 bytes are 0 anyway

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
        const vsize = dv.getUint32LE(offset); offset += 8;  // vsize is uint64, only the first 4 are relevant
        const csize = dv.getUint32LE(offset); offset += 8;  // same as vsize
        const mode  = dv.getUint8   (offset); offset += 1;

        if (vsize !== 3 * 8 || csize !== 0) {               // need to receive 3 * size_t, uncompressed
          reject(new Error('Incorrect data in server agreement'));
        }

        // extract the reply: agree, spaceParam, timeParam
        const agreeL = dv.getUint32LE(offset);
        const agreeH = dv.getUint32LE(offset + 4);
        offset += 8;

        const spaceL = dv.getUint32LE(offset);
        const spaceH = dv.getUint32LE(offset + 4);
        offset += 8;

        const  timeL = dv.getUint32LE(offset);
        const  timeH = dv.getUint32LE(offset + 4);

        if (mode !== NETWORK.MODE.AUTH || agreeL !== 0x0000ffff || agreeH !== 0x0000ffff) {
          reject(new Error('Server agreement failed'));
        }

        if (spaceH !== 0 || timeH !== 0) {
          reject(new Error('Server parameters bigger than expected'));
        }

        // all is well, setup the next messages
        socket.onmessage = this.deserialize.bind(this);
        this.socket = socket;

        resolve({ spaceParam: spaceL, timeParam: timeL });
      };
    });
  }

  deserialize(newMsgEvt) {
    const msg = new Message(newMsgEvt.data);
    if (!this.array)  this.array = msg.popArray();
    else              msg.fillArray(this.array);

    // consume -- pop as many arrays as possible from the rest of the message
    while (this.array && this.array.isFull) {
      this.dataReceiverCb(this.array);
      this.array = msg.popArray();
    }
  }
}