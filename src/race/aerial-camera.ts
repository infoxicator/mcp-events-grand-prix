import {TrackingCameraRig,AERIAL_CAMERA} from './tracking-camera';
export {battleStation as aerialStation} from './tracking-camera';
/** Compatibility entry point for the aerial review tools and regressions. */
export class AerialCameraRig extends TrackingCameraRig {constructor(){super(AERIAL_CAMERA);}}
