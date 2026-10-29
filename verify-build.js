// Build the static site for Render, no npm dependencies required.
const fs=require('node:fs');
const path=require('node:path');
const required=['index.html','app.js','motion.js','tracking.js','styles.css','favicon.svg'];
const root=__dirname;
for(const name of required){
 const filepath=path.join(root,name);
 if(!fs.existsSync(filepath)||!fs.statSync(filepath).isFile()){
   console.error(`MISSING at GitHub repo root: ${name}. Make sure the contents of the ZIP were uploaded at the TOP LEVEL, not inside another folder.`);
   process.exit(1);
 }
}
const dist=path.join(root,'dist');
fs.rmSync(dist,{force:true,recursive:true});
fs.mkdirSync(dist);
for(const name of required){fs.copyFileSync(path.join(root,name),path.join(dist,name));console.log('Copied '+name);}
console.log('SUCCESS: Static site ready in dist/');
