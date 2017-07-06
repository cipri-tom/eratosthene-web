import { EARTH, MAX_SCALE_VALUE } from './address';

/** Convert ellipsoidal coordinates to cartesian. NOTE: `lat` is angle with horizontal plane (PI/2 - theta)
 * @param{number[]} pose - [lon, lat, rad] -- not changed
 * @return{number[]} - [x, y, z]
 */
function sphericalToCartesian(pose) {
  const cart = [0, 0, 0];
  cart[0] = pose[2] * Math.cos(pose[1]) * Math.sin(pose[0]); // x
  cart[1] = pose[2] * Math.sin(pose[1]);                     // y
  cart[2] = pose[2] * Math.cos(pose[1]) * Math.cos(pose[0]); // z
  return cart;
}


/**  Specialised distance function from the viewpoint to the *center* of the cell given by `addr`
 * @param{Address} addr - The address of a cell
 * @param{number[]} viewPose - A [lon,lat,alt] pose of the view point */
export function distance(addr, viewPose) {
  // since pose is at the "edge" shift to get distance to the cell's centre
  const scale = 1 << (addr.size + 1);
  const shift = EARTH.RANGE_LON / scale;
  let cellPose = addr.pose;
  cellPose[0] += shift;
  cellPose[1] += shift;
  cellPose[2] += 2 * Math.PI * EARTH.RADIUS / scale;

  // convert both to cartesian
  cellPose = sphericalToCartesian(cellPose);
  viewPose = sphericalToCartesian(viewPose);

  // compute difference (reusing the same array)
  cellPose[0] -= viewPose[0];
  cellPose[1] -= viewPose[1];
  cellPose[2] -= viewPose[2];

  // distance is norm of difference
  return Math.sqrt(cellPose[0] * cellPose[0] + cellPose[1] * cellPose[1] + cellPose[2] * cellPose[2]);
}

/** Shalala
 * @param{number} altitude - Absolute altitude (distance from Earth center)
 * @return{number} Threshold above which cells are no longer interesting */
export function distanceThreshold(altitude) {
  const normal = altitude / EARTH.RADIUS - 1;
  // threshold magic:
  return (altitude * (1 - 0.75 * Math.exp(- Math.PI * normal * normal)));
}

/** Checks the necessary cell span (i.e. level of detail) for satisfactory
 visualisation based on distance from viewpoint and model parameters.
 A cell needs more depth (details/points) if it's closer or we are zoomed
 in with a big scale (i.e. looking at a statue, not at a mountain)

 @param{number} dist - Distance from viewpoint
 @param{number} spaceParam - Configuration of the model data structure
 @param{number} scale - The scale at which we want to check
 @return{boolean}
 */
export function enoughDetail(dist, spaceParam, scale) {
  const clamp = spaceParam - MAX_SCALE_VALUE - 2;

  /* last term can be adjusted to control the level of detail. It takes values
   * in [9.3, 9.7] (9.5 default). Bigger value => more detail => more recursion => more data */
  let normal = Math.log(EARTH.RADIUS / 2 / (dist * 30)) / Math.LN2 + 9.3;
  normal = normal < 5 ? 5 : (normal > clamp ? clamp : normal);

  return (normal - scale) < 1;
}

