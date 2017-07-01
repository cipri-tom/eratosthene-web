/* global Util */

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


/** Representation of raw data, as it comes in the socket: an array with a header.
 * ```
 *  <------------------- HEADER ----------------> <---- DATA ---->
 * | uint64: vsize | uint64: csize | uint8: mode | uint8[]: bytes |
 * ```
 */
class ErArray {
  /** Creates an empty array from the header bytes.
   * @param {!DataView} dv - View over the buffer containing this array header
   * @param {?number} [offset=0] - Offset in the above view, where the header starts
   */
  constructor(dv, offset) {
    offset = offset || 0;
    if (!(dv instanceof DataView)) throw new Error('Invalid parameter type for ErArray constructor')

    if (dv.byteLength - offset < ErArray.ARRAY_HEADER) throw new Error('Cannot build ErArray: incomplete header');

    /** The compressed size of the array i.e. the number of bytes coming on the network after the header
     * @type {number} */
    this.cLength = dv.getUint64LE(offset);

    /** How many bytes have been filled. Initially `0`, up to {@link ErArray#cLength}
     * @type {number} */
    this.cFilled = 0;

    /** Actual array length, after decompression
     * @type {number} */
    this.length  = dv.getUint64LE(offset + 8);

    /** The bytes of the compressed array. Released after decompression
     * @private */
    this.cBytes = null;
  }

  /** How many bytes still need to be received into this array
   * @type {number} */
  get neededBytes() { return this.cLength - this.cFilled; }

  /** Indicates that all bytes have been received
   * @type {boolean} */
  get isFull() { return this.cFilled === this.cLength; }

  /** Appends the given bytes to this array and decompresses it if it becomes full.
   * @param {Uint8Array} bytes - the bytes to add to this array */
  addBytes(bytes) {
    if (this.isFull) throw new Error('Array already full');
    if (bytes.byteLength === this.cLength) {
      // the whole array fit in bytes, we can decompress directly without copying
      this.decompress(bytes);
      this.cFilled = this.cLength;  // it is full
      return;
    }

    if (!this.cBytes) this.cBytes = new Uint8Array(this.cLength);
    this.cBytes.set(bytes, this.cFilled);
    this.cFilled += bytes.byteLength;

    if (this.isFull) this.decompress(this.cBytes);
  }

  decompress(bytes) {
    throw new Error('NYI');
  }
}

ErArray.ARRAY_HEADER_SIZES = 2 * 8; // 2 * uint64 (vsize, csize)
ErArray.ARRAY_HEADER_MODE = 1;     // uint8 for mode
/** How much space the header takes */
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

  get length() {
    return this.dv.byteLength - this.offset;
  }

  popArray() {
    if (this.offset === this.dv.byteLength) return null;
    const arr = new ErArray(this.dv, this.offset);
    this.fillArray(arr);
    this.offset += arr.cFilled;
    return arr;
  }

  popBytes(length) {
    length = length || this.length;
    if (length > this.length) throw new Error('Cannot pop more bytes than existing');
    const arr = new Uint8Array(this.dv.buffer, this.offset, length);
    this.offset += length;
    return arr;
  }

  /** Fills remaining bytes in the given array as much as possible */
  fillArray(array) {
    const howMany = Math.min(this.length, array.neededBytes);
    const bytes = this.popBytes(howMany);
    array.addBytes(bytes);
  }
}

class Serializer {
  constructor() {
    this.socket = null;
    this.dataReceiverCb = null;
    this.prevMsg = null;
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
    if (this.prevMsg) {
      // having a previous message means that we couldn't construct an array from it
      // because it didn't contain the whole array header
      if (this.array) throw new Error('Cannot have both a prevMsg and a prevArray');

      const headerBytes = new Uint8Array(ErArray.ARRAY_HEADER);
      const numInPrev = this.prevMsg.length;
      const numInCurr = ErArray.ARRAY_HEADER - numInPrev;
      headerBytes.set(this.prevMsg.popBytes(numInPrev), 0);
      headerBytes.set(msg.popBytes(numInCurr), numInPrev);
      this.array = new ErArray(new DataView(headerBytes.buffer));
    }

    if (this.array) msg.fillArray(this.array);    // leftover array, need to fill it
    else            this.array = msg.popArray();  // no leftovers, start a new one

    // consume -- pop as many arrays as possible from the rest of the message
    while (this.array && this.array.isFull) {
      this.dataReceiverCb(this.array);
      this.array = msg.popArray();
    }
  }
}
