import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const files=['tracking','motion'];
async function load(name){const source=readFileSync(new URL(`../${name}.js`,import.meta.url),'utf8');return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));}
const {TrackManager}=await load('tracking');
const {MotionDetector}=await load('motion');
const tracking=new TrackManager('FC');
const a=tracking.ingest([{x:100,y:90,w:80,h:80,confidence:.8}],1000,640,480);
assert.equal(a.length,1);assert.equal(a[0].id,'FC-001');
const b=tracking.ingest([{x:110,y:100,w:80,h:80,confidence:.75}],1300,640,480);
assert.equal(b.length,0);assert.equal(tracking.active(1400)[0].id,'FC-001');
tracking.ingest([{x:460,y:100,w:80,h:80}],1500,640,480);
assert.equal(tracking.active(1500).length,2);
tracking.prune(2701);assert.equal(tracking.tracks.length,0);
const engine=new MotionDetector(160,96,8);
const black=new Uint8ClampedArray(160*96*4),white=new Uint8ClampedArray(black);
for(let i=0;i<black.length;i+=4)black[i+3]=white[i+3]=255;
for(let y=18;y<67;y++)for(let x=40;x<85;x++){let i=(y*160+x)*4;white[i]=white[i+1]=white[i+2]=240;}
assert.deepEqual(engine.analyze(black,60),[]);
const areas=engine.analyze(white,60);
assert.ok(areas.some(v=>v.x<50&&v.x+v.w>70&&v.y<40&&v.y+v.h>55),'moving white rectangle detected');
const fullWhite=new Uint8ClampedArray(black);
for(let i=0;i<fullWhite.length;i+=4){fullWhite[i]=fullWhite[i+1]=fullWhite[i+2]=255;fullWhite[i+3]=255;}
assert.deepEqual(engine.analyze(fullWhite,60),[]);
assert.ok(engine.cameraMoved,'full image change is flagged as camera movement');
console.log('PASS: track IDs, matching, expiry, motion regions, camera-shake handling');
