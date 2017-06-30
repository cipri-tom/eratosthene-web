'use strict';

/* global WebUtil THREE Cell Model */

WebUtil.init_logging(); // use with link as http://....?logging=info

// eslint-disable-next-line one-var,one-var-declaration-per-line
let renderer, scene, camera, controls, gui;
let material_g;
let cell_g;
let cameraPos, cameraRot;
let model;

function init_controls(camera, canvas) {
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.rotateSpeed = 0.0001;
  controls.zoomSpeed   = 0.0001;
  controls.panSpeed    = 1.0;

  controls.enableZoom = true;
  controls.enablePan  = true;
  controls.enableKeys = false;

  return controls;
}

function init_gui(controls) {
  var gui = new dat.GUI();
  gui.add(controls, 'zoomSpeed'  , 0, 3);
  gui.add(controls, 'rotateSpeed', 0, 3);
  gui.add(controls, 'panSpeed'   , 0, 3);
  return gui;
}

function initRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, logarithmicDepthBuffer: true });
  renderer.setSize(800, 640);
  renderer.setClearColor(0x0, 1);
  return renderer;
}

/** Initializes a new scene with an origin and a model of the Earth */
function initScene(originMat) {
  const scene = new THREE.Scene();

  // display origin
  const originGeom = new THREE.Geometry();
  originGeom.vertices.push(new THREE.Vector3(0, 0, 0));
  originGeom.colors.push(new THREE.Color(1, 1, 1));
  const origin = new THREE.Points(originGeom, originMat);
  scene.add(origin);

  // display earth
  const mat        = new THREE.LineBasicMaterial({ color: 0x208820, linewidth: 2 });
  const earth      = new THREE.SphereBufferGeometry(EARTH_RADIUS, 24, 30);  // FIXME make sure EARTH_RADIUS is defined
  const earthEdges = new THREE.EdgesGeometry(earth);
  const wireframe  = new THREE.LineSegments(earthEdges, mat);
  scene.add(wireframe);

  return scene;
}

function initCamera(scene) {
  const camera = new THREE.PerspectiveCamera(
                  75,             // Field of view
                  800 / 640,      // Aspect ratio
                  1,              // Near plane
                  1e8,            // Far plane
  );
  // above big tiles
  camera.position.set(695030.2193962388, 4992938.408158433, 4750739.144573923);

  // above small model with correct orientation
  // camera.position.set( 492731.9116620413, 4414565.349344852, 4577862.348045128 );

  // above small model with wrong orientation
  // camera.position.set( 472399.82473350444, 4604239.973148383, 4389188.252209952 );
  // camera.position.set( 472394.9785697057, 4604192.740063384, 4389143.225255882 );

  // camera.position.set( 472283.76106439694, 4604562.653440646, 4389503.187120511 );
// [492664.38770525873, 4414496.867704961, 4577663.836644989]


  camera.lookAt(scene.position);

  // set some logging elements
  cameraPos = document.getElementById('cameraPos');
  cameraRot = document.getElementById('cameraRot');

  cameraPos.textContent = camera.position.toArray().join('   ');
  cameraRot.textContent = camera.rotation.toArray().join('   ');

  return camera;
}

function init() {
  // init material
  material_g = new THREE.PointsMaterial({
                  // color: 0xFF0000,
                  vertexColors : THREE.VertexColors,
                  size: 1.0,
                  sizeAttenuation: false,
              });

  // init global vars
  const cvs = document.getElementById('le_canvas');
  renderer = initRenderer(cvs);
  scene    = initScene();
  camera   = initCamera(scene);

  controls = init_controls(camera, cvs);
  gui      = init_gui(controls);

  model    = new Model();
  controls.addEventListener('end', model.handle_update);
  controls.addEventListener('change', render);

  camera.position.set(695030.2193962388, 4992938.408158433, 4750739.144573923);
  controls.rotateSpeed = 0.1;
  controls.zoomSpeed = 0.1;
  model._seed_addr = new Address("/950486422//0");


  // camera.position.set( 472416.78669831273, 4604405.292761797, 4389345.850186872 );
  // camera.lookAt(scene.position);
  // controls.rotateSpeed = 0.0001;
  // controls.zoomSpeed = 0.0001;
  // model._seed_addr = new Address("/-3773779200//0");

  render();
}


function query(addrStr) {
  console.log(addrStr);
  const cell = new Cell(addrStr);
  cell.callback = update;  // FIXME really used before defined ? check with ESLint
  cell.query();
}

function render() {
  // console.log('render');
  renderer.render(scene, camera);
  cameraPos.textContent = camera.position.toArray().join('   ');
  cameraRot.textContent = camera.rotation.toArray().join('   ');
}

function update(cell) {
  const points = new THREE.Points(cell.get_geometry(), material_g);
  scene.add(points);
  render();
}

window.onload = init;
