import { Address, EARTH, MAX_SCALE_VALUE } from './address';
import * as Geo from './geodesy';
import Serial from './serial';
import {
  WebGLRenderer, Scene, PerspectiveCamera,
  PointsMaterial, LineBasicMaterial,
  EdgesGeometry, SphereBufferGeometry, LineSegments,
  VertexColors }
  from '../lib/three.modules';
import OrbitControls from '../lib/OrbitControls';

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

export default function Model(canvas, autoFill) {
  // --- INITIALISATION -----------------------------------------------------------------------------------------------
  this.autoFill = autoFill || false;

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
  camera.lookAt(scene.position);

  const material = new PointsMaterial({
    // color: 0xFF0000,
    vertexColors: VertexColors,
    size: 1.0,
    sizeAttenuation: false,
  });

  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, {
    rotateSpeed: 0.0001,
    zoomSpeed: 0.0001,
    panSpeed: 1.0,
    enableZoom: true,
    enablePan: true,
    enableKeys: false,
    minDistance: EARTH_RADIUS - 10000,
    maxDistance: EARTH_RADIUS + 10000,
  });
  // this.controls = controls;


  let viewPose = [0, 0, 0];     // lon, lat, alt

  Serial.connect(receiveData).then((result) => {
    // everything is OK, proceed with setup
    this.spaceParam = result.spaceParam;
    this.timeParam  = result.timeParam;

    controls.addEventListener('end', handleUpdate);
    controls.addEventListener('change', this.render.bind(this));

    this.resetView();

    // const addrDv = new DataView(new ArrayBuffer(Address.BUFFER_SIZE + 17)); // array header
    // let offset = 0;
    // // write array header
    // addrDv.setInt64LE(offset, Address.BUFFER_SIZE); offset += 8;
    // addrDv.setInt64LE(offset, 0);                   offset += 8;
    // addrDv.setUint8(offset, 0x03);                  offset += 1;
    //
    // // address times
    // addrDv.setInt64LE(offset, -3773779200); offset += 8;  // t0
    // addrDv.setInt64LE(offset, 0);           offset += 8;  // t1
    //
    // // address descriptor
    // addrDv.setUint8(offset, 19);            offset += 1;  // size
    // addrDv.setUint8(offset,  1);            offset += 1;  // mode
    // addrDv.setUint8(offset,  8);            offset += 1;  // span
    //
    // // address digits
    // const  = new Uint8Array(addrDv.buffer, offset, Address.DIGITS_SIZE);
    // addrDigits.set([1, 2, 2, 0, 0, 1, 0, 0, 2, 3, 4, 3, 3, 1, 3, 2, 4, 3, 4]);
    // console.log(new Uint8Array(addrDv.buffer));
    //
    // Serial.socket.send(addrDv.buffer);
  }).catch((error) => { console.log(error); });

  // --- PUBLIC METHODS -----------------------------------------------------------------------------------------------

  /** Exposed function to "jump" to the given coordinates (cartesian)
   * @param {?number[]} coords - The [x, y, z] in absolute values. If not given, sets to default view */
  this.setView = (coords) => {
    if (!coords) {
      // set to default view
    } else {
      camera.position.set(...coords);
    }
    // TODO update this.viewPose = cartesianToSpherical(coords)
    // no need to update the controls
    // this.update();
  };

  /** Sets the view to a default position */
  this.resetView = () => {
    this.setView(defaultView);
  };

  this.shouldAutoFill = (value) => {
    this.autoFill = value;
  };
  
  this.render = () => {
    renderer.render(scene, camera);
  };

  // --- INTERNALS ----------------------------------------------------------------------------------------------------
  function buildEarth() {
    const mat        = new LineBasicMaterial({ color: 0x208820, linewidth: 2 });
    const earth      = new SphereBufferGeometry(EARTH_RADIUS, 24, 30);  // FIXME make sure EARTH_RADIUS is defined
    const earthEdges = new EdgesGeometry(earth);
    return new LineSegments(earthEdges, mat);  // wireframe
  }

  const cache = {};       // cache[addr] = CellObject when the cell is available and rendered
  const toQuery = [];   // list of generated addrs
  const seedAddr = new Address('/1/950486422,950486422//7'); // FIXME: from er_view_get_times
  function getViewableAddrs(addr, scale) {
    // create new slot
    addr.digits.push(0);
    if (addr.size !== scale + 1) {
      Util.Warn("Inconsistent address generation");
    }

    // iterate through all the possible digits that can appear at `scale`
    let maxDigit = Address.maxValue(scale);
    for (let digit = 0; digit < maxDigit; ++digit) {
      // update address with this digit
      addr.digits[scale] = digit;

      // if we already know it is empty, skip all daughters
      if (cache[addr] === 0) {
        return;
      }

      // TODO: check negative distance (sometimes)(due to wrong `lat` angle in `viewPose`)
      const dist = Geo.distance(addr, viewPose);

      // generate unconditionally for the first 3 levels
      if (scale <= UNCONDITIONAL_SCALE_EXPANSION) {
        getViewableAddrs(addr, scale + 1);

      // for higher levels, it must be close enough:
      } else if (dist < Geo.distanceThreshold(viewPose[2])) {
        // and have enough detail at this scale
        if (Geo.enoughDetail(dist, this.spaceParam, scale)) {
          if (!cache[addr]) {
            // TODO: check maximum number of new cells
            toQuery.push(addr.clone());
          }

        // otherwise expand it (if it can still be expanded)
        } else if (scale + MAX_SCALE_VALUE + 2 < this.spaceParam) {
          getViewableAddrs(addr, scale + 1);
        }
      }
    }

    // finished with this scale, backtrack
    addr.digits.pop();
  }

  function receiveData(data) {
    console.log(data);
  }

  // we need `var` here because we want this hoisted to the top, to be able to be referenced before using
  // and we don't want to use `function handleUpdate` because of problems with referencing `this`
  // eslint-disable-next-line vars-on-top, no-var
  var handleUpdate = (evt) => {
    // only on 'end', which is emitted by Controls
    if (evt.type !== 'end') return;

    // update viewPose
    viewPose[0] = controls.getAzimuthalAngle();                // longitude -- around y axis
    viewPose[1] = Math.PI / 2 - controls.getPolarAngle();      // latitude  -- around x axis
    viewPose[2] = controls.object.position.length();

    // TODO: adjust controls params

    if (this.autoFill) {
      const newAddrs = Address.generate(this, this.seedAddr, 0);
      Serial.serialize(newAddrs);
    }
  };

}
