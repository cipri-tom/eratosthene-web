"use strict";

WebUtil.init_logging(); // use with link as http://....?logging=info

var renderer, scene, camera, controls, gui;
var material_g;
var cell_g;
var camera_pos, camera_rot;
var model;

function init_controls(camera, canvas) {
    var controls = new THREE.OrbitControls(camera, canvas);
    controls.rotateSpeed = 0.0001;
    controls.zoomSpeed = 0.0001;
    controls.panSpeed = 1.0;

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

function init_renderer(canvas) {
    var renderer = new THREE.WebGLRenderer({canvas: canvas, logarithmicDepthBuffer: true});
    renderer.setSize(800, 640);
    renderer.setClearColor( 0x0, 1);
    return renderer;
}

function init_scene(origin_mat) {
    /** Initializes a new scene with an origin and a model of the Earth*/
    var scene  = new THREE.Scene();

    // display origin
    var origin_geom = new THREE.Geometry();
    origin_geom.vertices.push(new THREE.Vector3(0,0,0));
    origin_geom.colors.push(new THREE.Color(1,1,1));
    var origin   = new THREE.Points( origin_geom, origin_mat );
    scene.add( origin );

    // display earth
    var mat         = new THREE.LineBasicMaterial({color: 0x208820, linewidth: 2});
    var earth       = new THREE.SphereBufferGeometry(EARTH_RADIUS, 24, 30);
    var earth_edges = new THREE.EdgesGeometry(earth);
    var wireframe   = new THREE.LineSegments(earth_edges, mat);
    scene.add(wireframe);

    return scene;
}

function init_camera(scene) {
    /** Initializes and returns a camera*/
    var camera = new THREE.PerspectiveCamera(
                    75,             // Field of view
                    800 / 640,      // Aspect ratio
                    1,              // Near plane
                    1e8             // Far plane
    );
    // above big tiles
    camera.position.set( 695030.2193962388, 4992938.408158433, 4750739.144573923 );

    // above small model with correct orientation
    // camera.position.set( 492731.9116620413, 4414565.349344852, 4577862.348045128 );

    // above small model with wrong orientation
    // camera.position.set( 472399.82473350444, 4604239.973148383, 4389188.252209952 );
    // camera.position.set( 472394.9785697057, 4604192.740063384, 4389143.225255882 );

    // camera.position.set( 472283.76106439694, 4604562.653440646, 4389503.187120511 );
// [492664.38770525873, 4414496.867704961, 4577663.836644989]


    camera.lookAt(scene.position);

    // set some logging elements
    camera_pos = document.getElementById('camera_pos');
    camera_rot = document.getElementById('camera_rot');

    camera_pos.textContent = camera.position.toArray().join('   ');
    camera_rot.textContent = camera.rotation.toArray().join('   ');

    return camera
}

function init() {
    // init material
    material_g = new THREE.PointsMaterial({
                    // color: 0xFF0000,
                    vertexColors : THREE.VertexColors,
                    size: 1.0,
                    sizeAttenuation: false
                });

    // init global vars
    var cvs  = document.getElementById('le_canvas');
    renderer = init_renderer(cvs);
    scene    = init_scene();
    camera   = init_camera(scene);

    controls = init_controls(camera, cvs);
    gui      = init_gui(controls);

    model    = new Model();
    controls.addEventListener('end', model.handle_update);
    controls.addEventListener('change', render);

    camera.position.set( 695030.2193962388, 4992938.408158433, 4750739.144573923 );
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


function query(addr_str) {
    console.log(addr_str);
    var cell = new Cell(addr_str);
    cell.callback = update
    cell.query();
}

function render() {
    // console.log('render');
    renderer.render( scene, camera );
    camera_pos.textContent = camera.position.toArray().join('   ');
    camera_rot.textContent = camera.rotation.toArray().join('   ');
}

function update(cell) {
    var points = new THREE.Points(cell.get_geometry(), material_g);
    scene.add(points);
    render();
}


window.onload = init;
