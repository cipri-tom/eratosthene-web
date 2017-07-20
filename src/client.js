import GUI from '../lib/dat.gui.module';
import Model from './model';

/* global WebUtil Cell */

export default class Client {
  constructor(canvasID) {
    WebUtil.init_logging(); // use with link as http://....?logging=info

    this.model = new Model(document.getElementById(canvasID), document.getElementById('autoFill').checked);
    this.gui = new GUI.GUI();
    // this.gui.add(this.model.controls, 'zoomSpeed'  , 0, 3);
    // this.gui.add(this.model.controls, 'rotateSpeed', 0, 3);
    // this.gui.add(this.model.controls, 'panSpeed'   , 0, 3);


    // TODO: move in Model
  }
}

// for debugging, also export these:
export { Model };
export { Address } from './address';
export Serial from './serial';
