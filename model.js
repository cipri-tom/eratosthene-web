"use strict;"

function Model() {

    var m = {
        spatial_param: 32, // read from server: le_client_array
        time_param: 86400,
        pose: [0,0,0],     // lon, lat, alt
        cells: {}          // stores the addresses of the cells that have already been generated
    }
    return m;
}
