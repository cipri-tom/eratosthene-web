"use strict;"

function Model() {
    this.spatial_param = 32; // read from server: le_client_array
    this.time_param = 86400;
    this.pose = [0,0,0];     // lon, lat, alt
    this.cells = {};         // stores the addresses of the cells that have already been generated

    this._seed_addr = new Address("/-3773779200//0");
    var self = this;

    this.handle_update = function(evt) {
        // only on 'end', which is emitted by Controls
        if (evt.type !== 'end')
            return;

        if (document.getElementById('auto_fill').checked)
            fill_viewable(self, self._seed_addr, 0);
    }

    this.handle_mouse_down = function(evt) {
        evt.preventDefault();
        // register source to avoid click-only
        if (document.getElementById('fill_cb').checked)
            this.mouse_src = {'x': evt.clientX, 'y': evt.clientY};
    }

    this.handle_mouse_up = function(evt) {
        evt.preventDefault();
        // ignore if didn't click here
        if (! this.mouse_src)
            return;

        // fill on change
        if (model.mouse_src.x !== evt.clientX || model.mouse_src.y !== evt.clientY)
            fill();

        // reset
        model.mouse_src = null;
    }

}
