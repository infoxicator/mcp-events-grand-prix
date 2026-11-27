import {expect,it,vi} from 'vitest';
import {createDriveAudio} from '../src/race/drive-audio';

it('leaves the audio device unopened on mount and visibility changes until a sound is requested',()=>{
 const open=vi.fn();
 class Device{
  constructor(){open();throw Error('No playback device in this test');}
 }
 vi.stubGlobal('window',{AudioContext:Device});
 try{
  const audio=createDriveAudio();
  audio.setEnabled(true);audio.setEnabled(false);audio.playStartBeep(false);
  audio.setEnabled(true);expect(open).not.toHaveBeenCalled();
  audio.playStartBeep(false);expect(open).toHaveBeenCalled();
  audio.dispose();
 }finally{vi.unstubAllGlobals();}
});

it('releases a prepared device when the view is disposed before playback',()=>{
 const close=vi.fn(async()=>{});
 const audio=createDriveAudio({close} as unknown as AudioContext);
 audio.dispose();audio.dispose();
 expect(close).toHaveBeenCalledOnce();
});
