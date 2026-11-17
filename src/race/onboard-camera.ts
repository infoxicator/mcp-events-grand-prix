/** Chassis-local lens poses, metres. +Z is forward; pitch is down from horizontal. */
export function onboardLens(tv:boolean){
 return tv?{height:1.23,back:.505,pitch:23,fov:50,offset:.085}:{height:.765,back:.36,pitch:9,fov:68,offset:0};
}
