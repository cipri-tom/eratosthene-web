"use strict";

WebUtil.init_logging();
var renderer, scene, camera, controls, gui;
var material_g;
var cell_g;
var camera_pos;

function init_controls() {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.rotateSpeed = 0.1;
    controls.zoomSpeed = 0.1;
    controls.panSpeed = 1.0;

    controls.enableZoom = true;
    controls.enablePan  = true;

    controls.enableDamping = true;
    controls.dampingFactor = 0.3;
    controls.addEventListener('change', render);
}

function init_gui() {
    gui = new dat.GUI();
    gui.add(controls, 'zoomSpeed'  , 0, 3);
    gui.add(controls, 'rotateSpeed', 0, 3);
    gui.add(controls, 'panSpeed'   , 0, 3);

}

function init_scene() {
    // display origin
    var origin_geom = new THREE.Geometry();
    origin_geom.vertices.push(new THREE.Vector3(0,0,0));
    origin_geom.colors.push(new THREE.Color(1,1,1));
    var origin   = new THREE.Points( origin_geom, material_g );
    scene.add( origin );

    // display earth
    var mat         = new THREE.LineBasicMaterial({color: 0x208820, linewidth: 2});
    var earth       = new THREE.SphereBufferGeometry(EARTH_RADIUS, 24, 30);
    var earth_edges = new THREE.EdgesGeometry(earth);
    var wireframe   = new THREE.LineSegments(earth_edges, mat);
    scene.add(wireframe);

}

function init(cell) {
    var c = document.getElementById('le_canvas');
    renderer = new THREE.WebGLRenderer({canvas: c});
    renderer.setSize(800, 640);
    renderer.setClearColor( 0x0, 1);

    scene  = new THREE.Scene();

    // init camera
    camera = new THREE.PerspectiveCamera(
                75,             // Field of view
                800 / 640,      // Aspect ratio
                1,              // Near plane
                1e8             // Far plane
    );
    // camera.position.set( EARTH_RADIUS, EARTH_RADIUS, EARTH_RADIUS );
    camera.position.set( 2111672,  4730978,  10963018 );
    camera.lookAt( scene.position );
    camera_pos = document.getElementById('camera_pos');
    camera_pos.textContent = camera.position.toArray().join('   ');

    init_controls();
    init_gui();

    // init material
    material_g = new THREE.PointsMaterial({ // color: 0xFF0000,
                                            vertexColors : THREE.VertexColors,
                                            size: 5.0,
                                            sizeAttenuation: false
                                        });

    init_scene();

    renderer.render( scene, camera );
    animate();
}


function query(addr_str) {
    var cell = new Cell(addr_str);
    cell.callback = update
    cell.query();
}

function animate(){
    requestAnimFrame(animate);
    controls.update();
}


function render() {
    // console.log('render');
    renderer.render( scene, camera );
    camera_pos.textContent = camera.position.toArray().join('   ');
}

function update(cell) {
    console.log("update");
    var points = new THREE.Points(cell.geometry, material_g);
    scene.add(points);

    // 2102489.713178938 - 10678947.964956952
    // var positions = new Float32Array(cell.poses);  // precision loss
    // var colors    = new Uint8Array(cell.data);
    // var positions = new Float32Array( [
    //    -3.0, -1.0,  1.0,
    //     1.0, -1.0,  1.0,
    //     2.0,  1.0,  1.0,

    //     1.0,  1.0,  1.0,
    //    -1.0,  1.0,  1.0,
    //    -1.0, -1.0,  1.0
    // ]);
    // var colors    = new Uint8Array([
    //     1.0, 1.0, 1.0,
    //     1.0, 1.0, 1.0,
    //     1.0, 1.0, 1.0,

    //     1.0, 1.0, 1.0,
    //     1.0, 1.0, 1.0,
    //     1.0, 1.0, 1.0,
    // ]);
    // geometry.addAttribute('position', new THREE.BufferAttribute(positions, 3));
    // geometry.addAttribute('color'   , new THREE.BufferAttribute(colors   , 3)); // true -- normalise them when passing to the shader
    render();
}

window.onload = init;
