"use strict;"

function Model() {
    this.spatial_param = 32; // read from server: le_client_array
    this.time_param = 86400;
    this.pose = [0,0,0];     // lon, lat, alt
    this.cells = {};         // stores the addresses of the cells that have already been generated

    // this._seed_addr = new Address("/950486422//0");
    this._seed_addr = new Address("/-3773779200//0");
    var self = this;

    this.fill = function() {
        fill_viewable(self, self._seed_addr, 0);
    }

    this.handle_update = function(evt) {
        // only on 'end', which is emitted by Controls
        if (evt.type !== 'end')
            return;
        var controls = this;

        // update pose
        self.pose[0] = controls.getAzimuthalAngle(); // longitude -- around y axis
        self.pose[1] = Math.PI / 2 - controls.getPolarAngle();     // latitude  -- around x axis
        self.pose[2] = controls.object.position.length();

        // adjust controls params
        // controls.zoomSpeed =

        if (document.getElementById('auto_fill').checked)
            fill_viewable(self, self._seed_addr, 0);
    }
}
