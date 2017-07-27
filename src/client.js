import GUI from '../lib/dat.gui.module';
import Model from './model';
import Times from './times';

/* global WebUtil */

export default class Client {
  constructor(canvasID) {
    WebUtil.init_logging(); // use with link as http://....?logging=info

    const timesContainer = document.getElementById('times');
    const autoFill = document.getElementById('autoFill');
    const canvas   = document.getElementById(canvasID);

    this.times = new Times(timesContainer, 1);
    this.model = new Model(canvas, this.times, autoFill.checked);
    autoFill.addEventListener('change', (event) => { this.model.autoFill = event.target.checked; });

    document.addEventListener('keypress', (event) => {
      switch (event.key) {
        case 'q': this.times.setMode(1); break;
        case 'w': this.times.setMode(2); break;
        case 'e': this.times.setMode(3); break;
        case 'r': this.times.setMode(4); break;
        case 't': this.times.setMode(5); break;
      }
    });

    // this.gui = new GUI.GUI();
    // this.gui.add(this.model.controls, 'zoomSpeed'  , 0, 3);
    // this.gui.add(this.model.controls, 'rotateSpeed', 0, 3);
    // this.gui.add(this.model.controls, 'panSpeed'   , 0, 3);
  }
}

// for debugging, also export these:
export { Model };
export { Address } from './address';
export { default as Serial } from './serial';
