import Address from './address';
/* global Util */

/** Similar to the default getUint32 but it is always in little endian */
DataView.prototype.getUint32LE = function dvGetUint32LE(offset) {
  return this.getUint32(offset, true);
};

DataView.prototype.getUint64LE = function dvGetUint64LE(offset) {
  const lo = this.getUint32(offset, true);
  const hi = this.getUint32(offset + 4, true);
  const result = hi * 4294967296.0 + lo;
  if (result > Number.MAX_SAFE_INTEGER)
    throw new Error('Cannot extract uint64 safely');
  return result;
};

DataView.prototype.setInt64LE = function dvSetInt64LE(offset, value) {
  if (!Number.isSafeInteger(value))
    throw new Error('Cannot set int64 safely');

  let   hi = Math.floor(value / 4294967296.0);
  const lo = value - hi * 4294967296.0;
  if (value < 0) hi += 4294967296.0;

  this.setInt32(offset    , lo, true);
  this.setInt32(offset + 4, hi, true);
};


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
   * @throws {TypeError} when first parameter is not a DataView
   * @throws {Error} when the indicated bytes do not form a valid header
   */
  constructor(dv, offset) {
    offset = offset || 0;
    if (!(dv instanceof DataView)) throw new TypeError('Invalid parameter type for ErArray constructor')

    if (dv.byteLength - offset < ErArray.ARRAY_HEADER) throw new Error('Cannot build ErArray: incomplete header');

    /** The compressed size of the array == the number of bytes coming on the network after the header
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
    // TODO
    this.bytes = bytes;
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

  MODE: { AUTH: 0x01, RESILIATE: 0x02, QUERY: 0x03 },
};

/** Represents a message arrived over the socket and presents an interface for extracting {@link ErArray} from it */
class Message {
  /** @param {ArrayBuffer} buffer - The bytes of this message. Parsing will begin at offset 0 */
  constructor(buffer) {
    /** Holds a DataView over the bytes for easy extraction of data
     * @private
     * @type {DataView}
     */
    this.dv = new DataView(buffer);

    /** Offset in {@link Message#dv} indicating current parse position; incremented when popping data from the message
     * @private
     * @type {number}
     */
    this.offset = 0;
  }

  /** How many bytes are still available in this buffer (not yet parsed)
   * @type {number} */
  get length() {
    return this.dv.byteLength - this.offset;
  }

  /** Extract the next {@link ErArray}, advancing the parse state of this message
   * @returns {ErArray|null} The next (possibly incomplete) array or `null` if it's not possible
   * (in which case the message state is not altered) */
  popArray() {
    if (this.offset === this.dv.byteLength) return null;
    try {
      const arr = new ErArray(this.dv, this.offset);
      this.fillArray(arr);
      this.offset += arr.cFilled;
      return arr;
    } catch (err) {  // array creation failed
      return null;
    }
  }

  /** Extracts the next `count` bytes from this message (or up to `this.length`, whichever is shorter).
   * @param {number} count - How many bytes to extract
   * @return {Uint8Array} - The extracted bytes */
  popBytes(count) {
    const length  = count || this.length;
    if (length > this.length) throw new Error('Cannot pop more bytes than existing');
    const arr = new Uint8Array(this.dv.buffer, this.offset, length);
    this.offset += length;
    return arr;
  }

  /** Extracts bytes from this message into the given array.
   * Takes as many as possible or until array is full.
   * @param {ErArray} array - Destination array */
  fillArray(array) {
    const count = Math.min(this.length, array.neededBytes);
    const bytes = this.popBytes(count);
    array.addBytes(bytes);
  }
}

class Serial {
  constructor() {
    this.socket = null;
    this.dataReceiverCb = null;
    this.prevMsg = null;
  }

  /** Establishes an authenticated connection to the server and sets up further message exchanges */
  connect(dataReceiverCb) {
    if (this.socket)     throw new Error('Cannot connect twice');
    if (!dataReceiverCb) throw new Error('No data receiver given');

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

      socket.onopen = () => {
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

      socket.onmessage = (msg) => {
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

  serialize(addrs) {
    if (addrs.length === 0) return;

    // we could construct a whole ErArray and send it, but why bother copying the data over ?
    // for now we just compute the header upfront and send each address on its own
    // TODO: change with the above because it would possible cause less network fragmentation.
    // It would need addr.toBytes(into ErArray, offset)

    const numBytes = addrs.length * Address.BUFFER_SIZE;
    const arrHeader = new DataView(new ArrayBuffer(numBytes));
    // arrHeader.


  }

  deserialize(newMsgEvt) {
    const msg = new Message(newMsgEvt.data);
    if (this.prevMsg && this.prevMsg.length > 0) {
      // having a previous message means that we couldn't construct an array from it
      // because it didn't contain the whole array header
      if (this.array) throw new Error('Cannot have both a prevMsg and a prevArray');

      const headerBytes = new Uint8Array(ErArray.ARRAY_HEADER);
      const numInPrev = this.prevMsg.length;
      const numInCurr = ErArray.ARRAY_HEADER - numInPrev;
      headerBytes.set(this.prevMsg.popBytes(numInPrev), 0);
      headerBytes.set(         msg.popBytes(numInCurr), numInPrev);
      this.array = new ErArray(new DataView(headerBytes.buffer));
    }

    if (this.array) msg.fillArray(this.array);    // leftover array, need to fill it
    else            this.array = msg.popArray();  // no leftovers, start a new one

    // consume -- pop as many arrays as possible from the rest of the message
    while (this.array && this.array.isFull) {
      this.dataReceiverCb(this.array);
      this.array = msg.popArray();
    }
    this.prevMsg = msg;
  }
}

export default new Serial();