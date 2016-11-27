"use strict";

WebUtil.init_logging();
var renderer, scene, camera, controls, gui;
var material_g;
var cell_g;
var camera_pos;


function init(cell) {
    var c = document.getElementById('le_canvas');
    renderer = new THREE.WebGLRenderer({canvas: c});
    renderer.setSize(800, 640);
    scene  = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
                75,             // Field of view
                800 / 640,      // Aspect ratio
                1,              // Near plane
                1e8             // Far plane
    );
    camera.position.set( 10, 10, 10 );
    camera.lookAt( scene.position );

    camera_pos = document.getElementById('camera_pos');
    camera_pos.textContent = camera.position.toArray().join('   ');


    controls = new THREE.TrackballControls(camera, renderer.domElement);
    controls.rotateSpeed = 1.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 1.0;

    controls.noZoom = false;
    controls.noPan  = false;

    controls.staticMoving = true;
    controls.dynamicDampingFactor = 0.3;
    controls.keys = [65, 83, 68];
    controls.addEventListener('change', render);

    // var geometry = new  THREE.BoxGeometry( 200, 200, 200 );
    // var material = new THREE.MeshBasicMaterial( { color: 0xff0000, wireframe: true } );

    // var mesh = new THREE.Mesh( geometry, material );
    // scene.add( mesh );
    material_g = new THREE.PointsMaterial({ // color: 0xFF0000,
                                            vertexColors : THREE.VertexColors,
                                            size: 5.0,
                                            sizeAttenuation: false
                                        });


    var geometry = new THREE.Geometry();
    geometry.vertices.push(new THREE.Vector3(0,0,0));
    geometry.colors.push(new THREE.Color(1,1,1));
    var origin   = new THREE.Points( geometry, material_g );
    scene.add( origin );

    gui = new dat.GUI();
    gui.add(controls, 'zoomSpeed', 0, 3);

    renderer.setClearColor( 0x0, 1);
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
