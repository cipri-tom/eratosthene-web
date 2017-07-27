import { Address, EARTH, MAX_SCALE_VALUE } from './address';
import * as Geo from './geodesy';
import Serial from './serial';
import Cell from './cell';
import Queue from '../lib/Queue';
import {
  WebGLRenderer, Scene, PerspectiveCamera,
  PointsMaterial, LineBasicMaterial,
  EdgesGeometry, SphereBufferGeometry, LineSegments,
  Vector3,
  VertexColors,
}
  from '../lib/three.modules';
import OrbitControls from '../lib/OrbitControls';

/* global Util */

// TODO BIG ONE: set all objects.matrixAutoUpdate to false. maybe also renderer.sortObjects

// some other default views :)
// above small model with correct orientation
// camera.position.set( 492731.9116620413, 4414565.349344852, 4577862.348045128 );

// above small model with wrong orientation
// camera.position.set( 472399.82473350444, 4604239.973148383, 4389188.252209952 );
// camera.position.set( 472394.9785697057, 4604192.740063384, 4389143.225255882 );

// camera.position.set( 472283.76106439694, 4604562.653440646, 4389503.187120511 );
// [492664.38770525873, 4414496.867704961, 4577663.836644989]

const UNCONDITIONAL_SCALE_EXPANSION = 3;
const DISPLAY_MAX_CELLS = 1024;

export default function Model(canvas, times, autoFill = false) {
  // --- INITIALISATION -----------------------------------------------------------------------------------------------
  this.autoFill = autoFill;
  this.times = times;

  // TODO set size from parameters
  this.viewWidth = 800;
  this.viewHeight = 640;

  const renderer = new WebGLRenderer({ canvas, logarithmicDepthBuffer: true });
  renderer.setSize(this.viewWidth, this.viewHeight);
  renderer.setClearColor(0x0, 1);

  const scene = new Scene();
  scene.add(buildEarth());

  const camera = new PerspectiveCamera(75, this.viewWidth / this.viewHeight, 1, 1e8);   // TODO make these dynamic
  const defaultView = [695030.2193962388, 4992938.408158433, 4750739.144573923];        // above big tiles
  this.camera = camera;

  const pointsMaterial = new PointsMaterial({
    // color: 0xFF0000,
    vertexColors: VertexColors,
    size: 1.0,
    sizeAttenuation: false,
  });

  const controls = new OrbitControls(camera, canvas, EARTH.RADIUS);
  Object.assign(controls, {
    rotateSpeed: 0.1,
    zoomSpeed: 0.1,
    panSpeed: 1.0,
    enableZoom: true,
    enablePan: true,
    enableKeys: false,
    minDistance: EARTH.ALTITUDE.MIN,
    maxDistance: EARTH.ALTITUDE.MAX,
  });
  this.controls = controls;


  Serial.connect(receiveData).then((result) => {
    // everything is OK, proceed with setup
    this.spaceParam = result.spaceParam;
    this.timeParam  = result.timeParam;

    // at the time of the fulfillment of this promise these will be defined
    controls.addEventListener('change', render);

    this.resetView();
  }).catch((error) => { console.log(error); });

  // --- PUBLIC METHODS -----------------------------------------------------------------------------------------------

  /** Exposed function to "jump" to the given coordinates (cartesian)
   * @param {!number[]} coords - The [x, y, z] in absolute values. If not given, sets to default view
   * @param {!number[]} [lookAtTarget=[0,0,0]] - The [x, y, z] in absolute values of a point to look at */
  this.setView = (coords, lookAtTarget = [0, 0, 0]) => {
    camera.position.set(...coords);
    camera.lookAt(new Vector3(...lookAtTarget));
    // no need to update the controls
    this.update(false);
  };

  /** Sets the view to a default position */
  this.resetView = () => {
    this.setView(defaultView);
  };

  const render = () => {
    renderer.render(scene, camera);
  };

  // --- INTERNALS ----------------------------------------------------------------------------------------------------
  function buildEarth() {
    const mat        = new LineBasicMaterial({ color: 0x208820, linewidth: 2 });
    const earth      = new SphereBufferGeometry(EARTH.RADIUS, 24, 30);
    const earthEdges = new EdgesGeometry(earth);
    return new LineSegments(earthEdges, mat);  // wireframe
  }


  const cache = {};             // cache[addr] = CellObject when the cell is available and rendered
  const toQuery = new Queue();  // list of generated addrs
  const getViewableAddrs = (addr, scale = 0) => {
    // create new slot
    addr.digits.push(0);
    if (addr.size !== scale + 1) {
      Util.Warn('Inconsistent address generation');
    }

    // iterate through all the possible digits that can appear at `scale`
    const maxDigit = Address.maxValue(scale);
    for (let digit = 0; digit < maxDigit; ++digit) {
      // update address with this digit
      addr.digits[scale] = digit;

      // if we already know it is empty, skip all daughters
      if (cache[addr] === 0) {
        addr.digits.pop();
        return;
      }

      // TODO: check negative distance (sometimes)(due to wrong `lat` angle in `viewPose`)
      const dist = camera.position.distanceTo(addr.poseCentre);

      // generate unconditionally for the first 3 levels
      if (scale <= UNCONDITIONAL_SCALE_EXPANSION) {
        getViewableAddrs(addr, scale + 1);

      // for higher levels, it must be close enough:
      } else if (dist < Geo.distanceThreshold(camera.position.length())) {
        // and have enough detail at this scale
        if (Geo.enoughDetail(dist, this.spaceParam, scale)) {
          if (!cache[addr]) {
            // TODO: check maximum number of new cells
            toQuery.enqueue(addr.clone());
          }

        // otherwise expand it (if it can still be expanded)
        } else if (scale + MAX_SCALE_VALUE + 2 < this.spaceParam) {
          getViewableAddrs(addr, scale + 1);
        }
      }
    }

    // finished with this scale, backtrack
    addr.digits.pop();
  };

  let numReceived = 0;
  function receiveData(data) {
    Util.Info(`Cell ${numReceived} received! Len: ${data.length}`);
    numReceived += 1;

    // save all empty cells
    const addr = toQuery.dequeue();
    if (!addr) throw new Error('Received more cells than asked for');

    if (data.length === 0) {
      cache[addr] = 0;
      return;
    }

    if (cache[addr]) {
      // this happens when you generate an "update" call before the previous one was fully received
      // TODO: use a better cache which allows to check the ones which are pending (toQuery)
      Util.Info('Received existing cell');
      return;
    }
    cache[addr] = true;

    // display this new data
    const cell = new Cell(addr, data, pointsMaterial);
    scene.add(cell);

    // remove oldest cell
    if (scene.children.length > DISPLAY_MAX_CELLS) {
      const oldCell = scene.children[1]; // the 0'th child is the earth
      oldCell.geometry.dispose();
      cache[oldCell.addr] = false;
      scene.remove(oldCell);  // TODO: possibly inefficient due to `splice` call
    }
    render();
  }

  const getSeedAddr = () => {
    const addr = new Address();
    addr.mode  = this.times.mode;
    addr.time  = this.times.getTimes();
    return addr;
  };

  this.update = (modeOrTimeChanged) => {
    // TODO: adjust controls params

    const seedAddr = getSeedAddr();
    if (this.autoFill) {
      getViewableAddrs(seedAddr);
      Serial.serialize(toQuery);
    }
    if (!modeOrTimeChanged) return;

    // remove outdated cells
    const toRemove = [];
    const objects = scene.children;
    for (let i = 1, l = objects.length; i < l; ++i) {  // start from 1 to skip earth !
      if (!(objects[i] instanceof Cell)) throw new Error('Trying to remove invalid child');

      const addr = objects[i].addr;
      if (addr.mode !== seedAddr.mode ||
          addr.mode !== 2 && addr.time[0] !== seedAddr.time[0] ||
          addr.mode !== 1 && addr.time[1] !== seedAddr.time[1]) {
        toRemove.push(objects[i]);
      }
    }
    scene.remove(...toRemove);
    render();
  };
  controls.addEventListener('end', this.update.bind(this, false));
  this.times.callback = this.update.bind(this, true);
}
