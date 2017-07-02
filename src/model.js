import Address, { EARTH_RADIUS } from './address';
import Serial from './serial';
import {
  WebGLRenderer, Scene, PerspectiveCamera,
  PointsMaterial, LineBasicMaterial,
  EdgesGeometry, SphereBufferGeometry, LineSegments,
  VertexColors }
  from '../lib/three.modules';
import OrbitControls from '../lib/OrbitControls';

// some other default views :)
// above small model with correct orientation
// camera.position.set( 492731.9116620413, 4414565.349344852, 4577862.348045128 );

// above small model with wrong orientation
// camera.position.set( 472399.82473350444, 4604239.973148383, 4389188.252209952 );
// camera.position.set( 472394.9785697057, 4604192.740063384, 4389143.225255882 );

// camera.position.set( 472283.76106439694, 4604562.653440646, 4389503.187120511 );
// [492664.38770525873, 4414496.867704961, 4577663.836644989]


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
  const cells = { cache: {}, toQuery: {} };  // stores the addresses of the cells that have already been generated
  const seedAddr = new Address('/1/950486422,950486422//0'); // FIXME


  Serial.connect(receiveData).then((result) => {
    // everything is OK, proceed with setup
    this.spaceParam = result.spaceParam;
    this.timeParam  = result.timeParam;

    controls.addEventListener('end', handleUpdate);
    controls.addEventListener('change', this.render.bind(this));

    this.resetView();


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

  function receiveData(data) {

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
