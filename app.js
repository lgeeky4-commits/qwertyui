import {TrackManager} from './tracking.js';
import {MotionDetector} from './motion.js';

const $=id=>document.getElementById(id);
const el={video:$('video'),overlay:$('overlay'),viewer:$('viewer'),surface:$('videoSurface'),empty:$('emptyState'),error:$('errorBox'),start:$('startBtn'),emptyStart:$('emptyStartBtn'),stop:$('stopBtn'),flip:$('flipBtn'),snapshot:$('snapshotBtn'),record:$('recordBtn'),recordLabel:$('recordLabel'),fullscreen:$('fullscreenBtn'),clear:$('clearBtn'),faceToggle:$('facesToggle'),motionToggle:$('motionToggle'),trailsToggle:$('trailsToggle'),keypointsToggle:$('keypointsToggle'),mirrorToggle:$('mirrorToggle'),sensitivity:$('sensitivity'),sensitivityValue:$('sensitivityValue'),model:$('modelStatus'),retryModel:$('retryModel'),faceHead:$('faceEngineHead'),cameraName:$('cameraName'),feedLabel:$('feedLabel'),feedMode:$('feedMode'),liveIndicator:$('liveIndicator'),recordDot:$('recordDot'),resText:$('resText'),bottomLeft:$('bottomLeft'),bottomRight:$('bottomRight'),faceCount:$('faceCount'),motionCount:$('motionCount'),fpsCount:$('fpsCount'),cameraStatus:$('cameraStatus'),targetTotal:$('targetTotal'),trackList:$('trackList'),logList:$('logList'),clearLog:$('clearLogBtn'),systemMessage:$('systemMessage'),clock:$('clock'),liveTime:$('liveTime'),toast:$('toast')};
const ctx=el.overlay.getContext('2d');
const motionCanvas=document.createElement('canvas');motionCanvas.width=160;motionCanvas.height=96;
const motionCtx=motionCanvas.getContext('2d',{willReadFrequently:true});
const captureCanvas=document.createElement('canvas');const captureCtx=captureCanvas.getContext('2d');
const motion=new MotionDetector();const faces=new TrackManager('FC',1100);const moving=new TrackManager('MO',900);
let facing='environment',stream=null,faceDetector=null,faceLoading=null,faceFailed=false,started=false,animation=0,session=0;
let lastMotion=0,lastFace=0,lastUi=0,lastVideoTime=-1,fpsFrame=0,fpsFrom=0,currentFPS=0;
let selectedId=null,mapping=null,toastTimer=0,recording=false,recorder=null,recordChunks=[],recordStream=null;
let lastActivityLog={face:0,motion:0,cameraMove:0};
const FACE_VERSION='0.10.22';
const FACE_WASM=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${FACE_VERSION}/wasm`;
const FACE_ESM=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${FACE_VERSION}/vision_bundle.mjs`;
const FACE_MODEL='https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

const pad=n=>String(n).padStart(2,'0');
const nowClock=()=>{const d=new Date();return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;};
function tickClock(){el.clock.textContent=nowClock()+' UTC';el.liveTime.textContent=nowClock();}
tickClock();setInterval(tickClock,1000);
function log(message,type='normal'){
  const line=document.createElement('div');line.className='log-line '+(type==='error'?'error':type==='alert'?'alert':'');
  const ts=document.createElement('span');ts.className='time';ts.textContent='['+nowClock()+'] ';
  line.append(ts,document.createTextNode(message));el.logList.prepend(line);
  while(el.logList.children.length>55)el.logList.lastElementChild.remove();
}
function notify(text,bad=false){el.toast.textContent=text;el.toast.className='toast show'+(bad?' bad':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.toast.className='toast',3200);}
function message(text){el.systemMessage.textContent=text;}
function setModelStatus(state,text){el.model.replaceChildren();const dot=document.createElement('span');dot.className='status-mini '+state;const label=document.createElement('span');label.textContent=text;el.model.append(dot,label);el.faceHead.textContent=state==='good'?'AI / READY':state==='bad'?'AI / UNAVAILABLE':'AI / LOADING';el.retryModel.hidden=state!=='bad';}
function errorInfo(text){el.error.textContent=text;el.error.hidden=false;log(text,'error');message(text);notify(text,true);}
function clearError(){el.error.hidden=true;el.error.textContent='';}
async function initializeFaceModel(){
  if(faceDetector)return faceDetector;
  if(faceLoading)return faceLoading;
  faceFailed=false;
  setModelStatus('loading','Downloading face model…');
  faceLoading=(async()=>{
    const {FaceDetector,FilesetResolver}=await import(FACE_ESM);
    const fileset=await FilesetResolver.forVisionTasks(FACE_WASM);
    const detector=await FaceDetector.createFromOptions(fileset,{baseOptions:{modelAssetPath:FACE_MODEL},runningMode:'VIDEO',minDetectionConfidence:0.53,minSuppressionThreshold:0.3});
    faceDetector=detector;
    setModelStatus('good','Face detector active');
    log('FACE ENGINE INITIALIZED');
    message('Live tracking enabled. Temporary IDs do not identify people.');
    return detector;
  })().catch(e=>{
    faceFailed=true;setModelStatus('bad','Face model unavailable');
    log('FACE MODEL LOAD FAILED: '+String(e?.message||e).slice(0,85),'error');
    message('Motion tracking works. Face detection needs internet to load its model. Use RETRY FACE MODEL after reconnecting.');
    return null;
  }).finally(()=>faceLoading=null);
  return faceLoading;
}
function updateButtons(){
  el.start.disabled=started;el.emptyStart.disabled=started;el.stop.disabled=!started;el.flip.disabled=!started;el.snapshot.disabled=!started;el.record.disabled=!started||(!recording&&!('MediaRecorder' in window));
  el.cameraStatus.textContent=started?'ON':'OFF';el.feedMode.textContent=started?'LIVE SENSOR':'STANDBY';el.feedLabel.textContent=started?'CAMERA CONNECTED':'NO SIGNAL';
  el.liveIndicator.classList.toggle('active',started);el.recordDot.classList.toggle('active',started);
  el.cameraName.textContent=started?(facing==='user'?'FRONT CAMERA':'REAR / DEFAULT'):'NOT CONNECTED';
}
async function startCamera(switchCamera=false){
  const ticket=++session;
  if(!navigator.mediaDevices?.getUserMedia){errorInfo('Camera access is not supported here. Open the site in HTTPS (or localhost) using a current browser.');return;}
  clearError();el.start.disabled=true;el.emptyStart.disabled=true;
  if(switchCamera){await stopCamera(false);if(ticket!==session)return;}
  try{
    const constraints={audio:false,video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}}};
    const cameraStream=await navigator.mediaDevices.getUserMedia(constraints);
    if(ticket!==session){cameraStream.getTracks().forEach(t=>t.stop());return;}
    stream=cameraStream;el.video.srcObject=stream;
    await el.video.play();
    if(ticket!==session){cameraStream.getTracks().forEach(t=>t.stop());return;}
    started=true;el.empty.hidden=true;el.resText.textContent=el.video.videoWidth+' x '+el.video.videoHeight;
    motion.reset();faces.clear();moving.clear();selectedId=null;lastVideoTime=-1;lastMotion=0;lastFace=0;lastUi=0;
    if(facing==='user')el.mirrorToggle.checked=true;
    else if(!switchCamera)el.mirrorToggle.checked=false;
    updateButtons();
    el.cameraStatus.textContent='ON';
    el.bottomLeft.textContent='TRACKING / ACTIVE';
    message('Camera active. Face detection may require a model download; motion tracking works independently.');
    log('CAMERA CONNECTED / '+el.video.videoWidth+'x'+el.video.videoHeight);
    stream.getVideoTracks().forEach(t=>t.addEventListener('ended',()=>{if(stream===cameraStream)stopCamera();},{once:true}));
    const currentSession=session;
    animation=requestAnimationFrame(time=>render(time,currentSession));
    if(el.faceToggle.checked&&!faceDetector)initializeFaceModel();
  }catch(e){
    if(ticket!==session)return;
    let detail='Unable to start the camera. Try another browser or device.';
    if(e.name==='NotAllowedError'||e.name==='PermissionDeniedError')detail='Camera permission denied. Allow camera access in your browser, then try again.';
    else if(e.name==='NotFoundError')detail='No usable camera was found on this device.';
    else if(e.name==='NotReadableError')detail='Camera is busy or blocked by another app. Close other camera apps and retry.';
    else if(e.name==='OverconstrainedError')detail='The requested camera settings are unavailable. Try flipping cameras.';
    errorInfo(detail);await stopCamera();
  }
}
async function stopCamera(invalidate=true){
  if(invalidate)session++;
  started=false;cancelAnimationFrame(animation);animation=0;
  if(recording)finishRecording();
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  el.video.pause();el.video.srcObject=null;
  motion.reset();faces.clear();moving.clear();selectedId=null;mapping=null;currentFPS=0;
  ctx.clearRect(0,0,el.overlay.width,el.overlay.height);
  el.empty.hidden=false;el.resText.textContent='-- x --';el.bottomLeft.textContent='SOURCE WAITING';
  el.faceCount.textContent='00';el.motionCount.textContent='00';el.fpsCount.textContent='--';
  if(!faceDetector&&!faceLoading&&!faceFailed)setModelStatus('loading','Awaiting camera');
  updateButtons();renderTracks();
}
async function flipCamera(){
  if(!started)return;
  // Keep an uninterrupted generation while shutting down the old stream.
  await stopCamera();
  facing=facing==='environment'?'user':'environment';
  el.mirrorToggle.checked=facing==='user';
  await startCamera();
}
function frameFit(){
  const viewW=el.surface.clientWidth,viewH=el.surface.clientHeight;
  const vw=el.video.videoWidth,vh=el.video.videoHeight;
  if(!viewW||!viewH||!vw||!vh)return null;
  const scale=Math.min(viewW/vw,viewH/vh);
  return {x:(viewW-vw*scale)/2,y:(viewH-vh*scale)/2,w:vw*scale,h:vh*scale,scale,vw,vh,mirror:el.mirrorToggle.checked};
}
function toDisplayX(x,w=0){return mapping.x+(mapping.mirror?mapping.vw-x-w:x)*mapping.scale;}
function toDisplayY(y){return mapping.y+y*mapping.scale;}
function resizeOverlay(){const w=el.surface.clientWidth,h=el.surface.clientHeight,dpr=Math.min(window.devicePixelRatio||1,2);const pixelW=Math.round(w*dpr),pixelH=Math.round(h*dpr);if(el.overlay.width!==pixelW||el.overlay.height!==pixelH){el.overlay.width=pixelW;el.overlay.height=pixelH;}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);}
function findFaces(timestamp){
  if(!faceDetector||!el.faceToggle.checked||timestamp-lastFace<180)return;
  lastFace=timestamp;
  try{
    const res=faceDetector.detectForVideo(el.video,timestamp);
    const vw=el.video.videoWidth,vh=el.video.videoHeight;
    const detected=(res?.detections||[]).map(d=>{
      const b=d.boundingBox;
      if(!b)return null;
      return {x:Math.max(0,b.originX),y:Math.max(0,b.originY),w:Math.min(b.width,vw),h:Math.min(b.height,vh),confidence:d.categories?.[0]?.score??null,keypoints:(d.keypoints||[])};
    }).filter(Boolean);
    const newTracks=faces.ingest(detected,timestamp,vw,vh);
    if(newTracks.length&&timestamp-lastActivityLog.face>1600){log(`FACE DETECTED / ${newTracks.map(t=>t.id).slice(0,3).join(', ')}`);lastActivityLog.face=timestamp;}
  }catch(e){log('FACE ENGINE ERROR: '+String(e.message||e).slice(0,70),'error');faceDetector=null;faceFailed=true;setModelStatus('bad','Face processing failed');}
}
function findMotion(timestamp){
  if(!el.motionToggle.checked||timestamp-lastMotion<110)return;
  lastMotion=timestamp;
  const vw=el.video.videoWidth,vh=el.video.videoHeight;
  motionCtx.drawImage(el.video,0,0,motionCanvas.width,motionCanvas.height);
  const pixels=motionCtx.getImageData(0,0,motionCanvas.width,motionCanvas.height).data;
  const results=motion.analyze(pixels,+el.sensitivity.value);
  if(motion.cameraMoved){if(timestamp-lastActivityLog.cameraMove>2800){log('SIGNIFICANT CAMERA / SCENE MOTION','alert');lastActivityLog.cameraMove=timestamp;}moving.ingest([],timestamp,vw,vh);return;}
  const candidates=results.map(b=>({x:b.x*vw/motionCanvas.width,y:b.y*vh/motionCanvas.height,w:b.w*vw/motionCanvas.width,h:b.h*vh/motionCanvas.height}));
  const newTracks=moving.ingest(candidates,timestamp,vw,vh);
  if(newTracks.length&&timestamp-lastActivityLog.motion>1700){log(`MOTION REGION / ${newTracks.map(t=>t.id).slice(0,3).join(', ')}`,'alert');lastActivityLog.motion=timestamp;}
}
function drawCorners(x,y,w,h,color,focused){
  const len=Math.max(9,Math.min(23,Math.min(w,h)*.23));ctx.lineWidth=focused?2.7:1.75;ctx.strokeStyle=color;
  ctx.beginPath();ctx.moveTo(x+len,y);ctx.lineTo(x,y);ctx.lineTo(x,y+len);
  ctx.moveTo(x+w-len,y);ctx.lineTo(x+w,y);ctx.lineTo(x+w,y+len);
  ctx.moveTo(x,y+h-len);ctx.lineTo(x,y+h);ctx.lineTo(x+len,y+h);
  ctx.moveTo(x+w-len,y+h);ctx.lineTo(x+w,y+h);ctx.lineTo(x+w,y+h-len);ctx.stroke();
}
function drawTracks(now){
  if(!mapping)return;
  const {x,y,w,h}=mapping;
  ctx.strokeStyle='#8acb8a55';ctx.lineWidth=1;
  const crossX=x+w/2,crossY=y+h/2;
  ctx.beginPath();ctx.moveTo(crossX-12,crossY);ctx.lineTo(crossX-4,crossY);ctx.moveTo(crossX+4,crossY);ctx.lineTo(crossX+12,crossY);ctx.moveTo(crossX,crossY-12);ctx.lineTo(crossX,crossY-4);ctx.moveTo(crossX,crossY+4);ctx.lineTo(crossX,crossY+12);ctx.stroke();
  const rendered=[...(el.faceToggle.checked?faces.active(now):[]).map(t=>({...t,kind:'FACE'})),...(el.motionToggle.checked?moving.active(now):[]).map(t=>({...t,kind:'MOTION'}))];
  for(const t of rendered){
    const tx=toDisplayX(t.x,t.w),ty=toDisplayY(t.y),tw=t.w*mapping.scale,th=t.h*mapping.scale;
    const focus=selectedId===t.id,green=t.kind==='FACE';const color=green?'#b7f58f':'#ffbf74';
    ctx.globalAlpha=Math.max(.24,1-(now-t.lastSeen)/1000);
    if(el.trailsToggle.checked&&t.trail.length>1){ctx.beginPath();for(let i=0;i<t.trail.length;i++){const point=t.trail[i];const px=toDisplayX(point.x),py=toDisplayY(point.y);if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.strokeStyle=color;ctx.lineWidth=1;ctx.stroke();}
    ctx.strokeStyle=color+'6a';ctx.lineWidth=1;ctx.strokeRect(tx,ty,tw,th);
    drawCorners(tx,ty,tw,th,color,focus);
    const label=`${t.id}  ${green?'FACE':'MOTION'}${t.confidence!=null?' '+Math.round(t.confidence*100)+'%':''}`;
    ctx.font='bold 10px monospace';const labelW=Math.ceil(ctx.measureText(label).width)+12;
    const labelY=ty>21?ty-18:ty+2;
    ctx.fillStyle='#06120edb';ctx.fillRect(tx,labelY,labelW,17);ctx.strokeStyle=color;ctx.lineWidth=1;ctx.strokeRect(tx,labelY,labelW,17);ctx.fillStyle=color;ctx.fillText(label,tx+6,labelY+12);
    if(green&&el.keypointsToggle.checked){ctx.fillStyle=color;for(const p of t.keypoints){if(!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;const px=toDisplayX(p.x*mapping.vw),py=toDisplayY(p.y*mapping.vh);ctx.beginPath();ctx.arc(px,py,2.1,0,Math.PI*2);ctx.fill();}}
    if(focus){ctx.strokeStyle=color;ctx.beginPath();const cx=tx+tw/2,cy=ty+th/2;ctx.arc(cx,cy,Math.min(28,Math.max(12,tw*.3)),0,Math.PI*2);ctx.stroke();ctx.fillStyle=color;ctx.fillText('SELECTED',tx,ty+th+15);}
    ctx.globalAlpha=1;
  }
}
function render(now,ticket){
  if(ticket!==session||!started)return;
  animation=requestAnimationFrame(time=>render(time,ticket));
  if(el.video.readyState<2||!el.video.videoWidth)return;
  fpsFrame++;if(!fpsFrom)fpsFrom=now;if(now-fpsFrom>1000){currentFPS=Math.round(fpsFrame*1000/(now-fpsFrom));fpsFrame=0;fpsFrom=now;}
  if(el.video.currentTime!==lastVideoTime){lastVideoTime=el.video.currentTime;findMotion(now);findFaces(now);}
  moving.prune(now);faces.prune(now);
  // Clear each frame even when camera has not changed, so old boxes can expire.
  resizeOverlay();mapping=frameFit();
  if(mapping)drawTracks(now);
  if(recording)drawCapture();
  if(now-lastUi>200){lastUi=now;refreshUI(now);}
}
function renderTracks(now=performance.now()){
  const faceEntries=el.faceToggle.checked?faces.active(now):[];
  const movingEntries=el.motionToggle.checked?moving.active(now):[];
  const all=[...faceEntries.map(t=>({t,kind:'face'})),...movingEntries.map(t=>({t,kind:'motion'}))].sort((a,b)=>b.t.lastSeen-a.t.lastSeen);
  if(selectedId&&!all.some(e=>e.t.id===selectedId))selectedId=null;
  el.targetTotal.textContent=pad(all.length);
  el.trackList.replaceChildren();
  if(!all.length){const empty=document.createElement('div');empty.className='list-empty';empty.textContent='NO ACTIVE TRACKS';const more=document.createElement('span');more.textContent=started?'Monitoring camera feed…':'Start camera to begin tracking';empty.append(more);el.trackList.append(empty);return;}
  for(const {t,kind} of all){
    const item=document.createElement('button');item.type='button';item.className='track-card'+(t.id===selectedId?' selected':'');item.setAttribute('aria-pressed',String(t.id===selectedId));
    const top=document.createElement('div');top.className='track-top';const id=document.createElement('span');id.textContent=t.id;const tag=document.createElement('span');tag.className='track-type '+(kind==='motion'?'motion':'');tag.textContent=kind==='face'?'FACE':'MOTION';top.append(id,tag);
    const detail=document.createElement('div');detail.className='track-detail';const pos=document.createElement('span');pos.textContent=`X ${Math.round(t.x)}  Y ${Math.round(t.y)}`;const conf=document.createElement('span');conf.textContent=kind==='face'&&t.confidence!=null?Math.round(t.confidence*100)+'% CONF':'MOVING AREA';detail.append(pos,conf);item.append(top,detail);
    item.addEventListener('click',()=>{selectedId=selectedId===t.id?null:t.id;renderTracks();});el.trackList.append(item);
  }
}
function refreshUI(now){
  const f=el.faceToggle.checked?faces.active(now).length:0,m=el.motionToggle.checked?moving.active(now).length:0;
  el.faceCount.textContent=pad(f);el.motionCount.textContent=pad(m);el.fpsCount.textContent=currentFPS?String(currentFPS).padStart(2,'0'):'--';
  el.bottomRight.textContent=`F:${pad(f)} / M:${pad(m)} / LOCAL`;
  renderTracks(now);
}
function drawCapture(){
  const w=captureCanvas.width,h=captureCanvas.height;
  if(!w||!h||!started||!mapping)return;
  captureCtx.fillStyle='#030808';captureCtx.fillRect(0,0,w,h);
  captureCtx.save();if(mapping.mirror){captureCtx.translate(w,0);captureCtx.scale(-1,1);}
  const scale=Math.min(w/el.video.videoWidth,h/el.video.videoHeight);const rw=el.video.videoWidth*scale,rh=el.video.videoHeight*scale;
  captureCtx.drawImage(el.video,(w-rw)/2,(h-rh)/2,rw,rh);captureCtx.restore();
  captureCtx.drawImage(el.overlay,0,0,w,h);
  captureCtx.fillStyle='#091711c9';captureCtx.fillRect(10,h-32,Math.min(w-20,370),24);
  captureCtx.fillStyle='#c3ef9d';captureCtx.font='bold 12px monospace';captureCtx.fillText(`VISION SENTINEL | ${nowClock()} UTC | LOCAL FEED`,17,h-16);
}
function setCaptureSize(){const width=Math.min(el.surface.clientWidth||1280,1280),height=Math.min(el.surface.clientHeight||720,720);const w=Math.max(320,Math.round(width*2)),h=Math.max(240,Math.round(height*2));if(captureCanvas.width!==w)captureCanvas.width=w;if(captureCanvas.height!==h)captureCanvas.height=h;}
function downloadBlob(blob,file){const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=file;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function filename(prefix,extension){return `${prefix}_${new Date().toISOString().replace(/[:.]/g,'-')}.${extension}`;}
async function snapshot(){if(!started)return;setCaptureSize();drawCapture();captureCanvas.toBlob(blob=>{if(blob){downloadBlob(blob,filename('sentinel_snapshot','png'));notify('SNAPSHOT SAVED');log('SNAPSHOT CAPTURED');}else notify('Could not export snapshot',true);},'image/png');}
function recordingMime(){if(!('MediaRecorder' in window))return null;return ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'].find(m=>MediaRecorder.isTypeSupported(m))||'';}
function beginRecording(){
  if(!started||recording||!('MediaRecorder' in window)||!captureCanvas.captureStream){notify('Recording is not supported by this browser',true);return;}
  try{setCaptureSize();drawCapture();recordStream=captureCanvas.captureStream(20);const mime=recordingMime();recorder=new MediaRecorder(recordStream,mime?{mimeType:mime,videoBitsPerSecond:3500000}:undefined);recordChunks=[];
    recorder.ondataavailable=e=>{if(e.data?.size)recordChunks.push(e.data);};
    recorder.onstop=()=>{const type=recorder?.mimeType||mime||'video/webm';if(recordChunks.length){downloadBlob(new Blob(recordChunks,{type}),filename('sentinel_recording',type.includes('mp4')?'mp4':'webm'));notify('VIDEO SAVED TO DEVICE');log('RECORDING EXPORTED');}recordChunks=[];recordStream?.getTracks().forEach(t=>t.stop());recordStream=null;};
    recorder.onerror=()=>{notify('Video recording failed',true);log('VIDEO RECORDER ERROR','error');};
    recorder.start(1000);recording=true;el.recordLabel.textContent='STOP REC';el.record.classList.add('recording');el.recordDot.classList.add('rec');log('LOCAL RECORDING STARTED','alert');notify('RECORDING STARTED');
  }catch(e){recording=false;recordStream?.getTracks().forEach(t=>t.stop());recordStream=null;notify('Recording unavailable: '+e.message,true);}
}
function finishRecording(){if(!recording)return;recording=false;el.recordLabel.textContent='RECORD';el.record.classList.remove('recording');el.recordDot.classList.remove('rec');if(recorder?.state==='recording')recorder.stop();log('RECORDING STOPPED');}
function clearTracks(){faces.clear();moving.clear();motion.reset();selectedId=null;renderTracks();refreshUI(performance.now());log('ALL TRACKS CLEARED');notify('TRACKS RESET');}
function selectCanvasTrack(e){if(!started||!mapping)return;const bounds=el.surface.getBoundingClientRect();const x=e.clientX-bounds.left,y=e.clientY-bounds.top;const tracks=[...faces.active(performance.now()),...moving.active(performance.now())];const found=tracks.reverse().find(t=>{const bx=toDisplayX(t.x,t.w),by=toDisplayY(t.y);return x>=bx&&x<=bx+t.w*mapping.scale&&y>=by&&y<=by+t.h*mapping.scale;});if(found){selectedId=selectedId===found.id?null:found.id;renderTracks();}}

el.start.addEventListener('click',()=>startCamera());el.emptyStart.addEventListener('click',()=>startCamera());el.stop.addEventListener('click',()=>{stopCamera();log('CAMERA DISCONNECTED');message('Camera disconnected; no feed is being stored or uploaded.');});
el.flip.addEventListener('click',flipCamera);
el.snapshot.addEventListener('click',snapshot);
el.record.addEventListener('click',()=>recording?finishRecording():beginRecording());
el.fullscreen.addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await el.viewer.requestFullscreen();}catch{notify('Fullscreen is unavailable on this browser',true);}});
el.clear.addEventListener('click',clearTracks);
el.clearLog.addEventListener('click',()=>{el.logList.replaceChildren();log('EVENT LOG CLEARED');});
el.surface.addEventListener('click',selectCanvasTrack);
el.sensitivity.addEventListener('input',()=>{el.sensitivityValue.textContent=el.sensitivity.value+'%';});
el.motionToggle.addEventListener('change',()=>{moving.clear();motion.reset();renderTracks();});
el.faceToggle.addEventListener('change',()=>{faces.clear();renderTracks();if(el.faceToggle.checked&&started&&!faceDetector)initializeFaceModel();});
el.mirrorToggle.addEventListener('change',()=>{notify(el.mirrorToggle.checked?'MIRROR ON':'MIRROR OFF');});
el.retryModel.addEventListener('click',initializeFaceModel);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&recording){finishRecording();notify('Recording stopped when tab was hidden');}});
window.addEventListener('pagehide',()=>{if(stream)stream.getTracks().forEach(t=>t.stop());});
updateButtons();log('ANALYSIS TERMINAL READY');
