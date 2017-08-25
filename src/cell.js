import { BufferGeometry, BufferAttribute, Points } from '../lib/three.modules';
import { EARTH } from './address';

/* global Util */

// constants
const CELL_DATA_SIZE = 3 * 1;    // RGB 1-byte colour
const CELL_POSE_SIZE = 3 * 8;    // longitude, latitude, altitude as double precision
const CELL_SIZE = CELL_DATA_SIZE + CELL_POSE_SIZE;

function Cell(addr, array, material) {
  // this.edge = addr.poseCentre; // TODO: edge is not at centre ;)
  this.addr = addr;

  // setup data reconstruction
  const dv = new DataView(array.rBytes.buffer);
  if (dv.byteLength % CELL_SIZE !== 0)  Util.Warn('WARNING: there are leftover bytes in transmission');

  let readOffset = 0, poseOffset = 0, dataOffset = 0;
  const pose = [0.0, 0.0, 0.0];   // preallocate: [lon, lat, rad]
  const cart = [0.0, 0.0, 0.0];   // preallocate: [x, y, z]

  this.size = Math.floor(dv.byteLength / CELL_SIZE);

  // setup geometry
  const positions  = new Float32Array(3 * this.size);
  const colors     = new Uint8Array(3 * this.size);

  const geometry = new BufferGeometry();
  geometry.addAttribute('position', new BufferAttribute(positions, 3));
  geometry.addAttribute('color'   , new BufferAttribute(colors   , 3, true)); // true -- normalise

  // inherit from Points
  Points.call(this, geometry, material);

  // disable auto update since this is static
  this.matrixAutoUpdate = false;

  // extract the geometry
  for (let currPt = 0; currPt < this.size; ++currPt) {
    // offsets are updated after each extraction; check if they are correct
    if (    readOffset !== currPt * CELL_SIZE
         || poseOffset !== currPt * 3
         || dataOffset !== currPt * 3) {
      throw new Error('Mis-aligned reading detected');
    }

    // extract vertices -- lon, lat, alt
    pose[0] = dv.getFloat64(readOffset     , true);  // true == little endian
    pose[1] = dv.getFloat64(readOffset + 8 , true);
    pose[2] = dv.getFloat64(readOffset + 16, true);
    readOffset += CELL_POSE_SIZE;

    // only the meaningful part of altitude is received, so we need to restore the rest
    pose[2] += EARTH.RADIUS;

    // convert and translate relative to edge
    cart[0] = pose[2] * Math.cos(pose[1]) * Math.sin(pose[0]); // x
    cart[1] = pose[2] * Math.sin(pose[1]);                     // y
    cart[2] = pose[2] * Math.cos(pose[1]) * Math.cos(pose[0]); // z
    // cart[0] = cart[0] - self.edge[0];
    // cart[1] = cart[1] - self.edge[1];
    // cart[2] = cart[2] - self.edge[2];

    // push in the cell's data
    positions[poseOffset    ] = cart[0];
    positions[poseOffset + 1] = cart[1];
    positions[poseOffset + 2] = cart[2];
    poseOffset += 3;  // number of extracted values

    // extract data -- consider parsing in a separate loop over Uint8Array
    colors[dataOffset    ] = dv.getUint8(readOffset)    ;
    colors[dataOffset + 1] = dv.getUint8(readOffset + 1);
    colors[dataOffset + 2] = dv.getUint8(readOffset + 2);
    readOffset += CELL_DATA_SIZE;
    dataOffset += 3;
  }
}

Cell.prototype = Object.assign(Object.create(Points.prototype), { constructor: Cell });

export default Cell;
