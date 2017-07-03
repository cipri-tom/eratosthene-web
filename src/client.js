import GUI from '../lib/dat.gui.module';
import Model from './model';
import Address from './address';
import Serial from './serial';

/* global WebUtil Cell */

export default class Client {
  constructor(canvasID) {
    WebUtil.init_logging(); // use with link as http://....?logging=info

    this.model = new Model(document.getElementById(canvasID), document.getElementById('autoFill'));
    this.gui = new GUI.GUI();
    // this.gui.add(this.model.controls, 'zoomSpeed'  , 0, 3);
    // this.gui.add(this.model.controls, 'rotateSpeed', 0, 3);
    // this.gui.add(this.model.controls, 'panSpeed'   , 0, 3);


    // TODO: move in Model
  }
}

function initCamera() {
  // set some logging elements
  cameraPos = document.getElementById('cameraPos');
  cameraRot = document.getElementById('cameraRot');

  cameraPos.textContent = camera.position.toArray().join('   ');
  cameraRot.textContent = camera.rotation.toArray().join('   ');

  return camera;
}

function init() {
  render();
}


function query(addrStr) {
  console.log(addrStr);
  const cell = new Cell(addrStr);
  cell.callback = update;  // FIXME really used before defined ? yes, but works because of function hoisting
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

export { Address, Model, Serial };
