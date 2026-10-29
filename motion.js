// Video frame/background subtraction on an intentionally small image for phones.
// Outputs moving *regions*, not semantic object classifications.
export class MotionDetector {
  constructor(width=160, height=96, cell=8) {
    this.width=width;this.height=height;this.cell=cell;
    this.cols=Math.ceil(width/cell);this.rows=Math.ceil(height/cell);
    this.background=null;
    this.cameraMoved=false;
  }
  reset(){this.background=null;this.cameraMoved=false;}
  analyze(data, sensitivity=60) {
    const {width,height,cell,cols,rows}=this;
    const length=width*height;
    if (!data || data.length < length*4) return [];
    const current=new Uint8Array(length);
    for(let i=0,k=0;i<length;i++,k+=4){current[i]=(data[k]*77 + data[k+1]*150 + data[k+2]*29)>>8;}
    if(!this.background){this.background=Float32Array.from(current);this.cameraMoved=false;return [];}
    const counts=new Uint16Array(cols*rows);
    const threshold=51-sensitivity*.37;
    for(let y=0;y<height;y++){
      for(let x=0;x<width;x++){
        const i=y*width+x;const brightness=current[i];const old=this.background[i];
        if(Math.abs(brightness-old)>threshold) counts[(y/cell|0)*cols+(x/cell|0)]++;
        // Slow background adaptation lets stationary objects stop registering as moving.
        this.background[i]=old+(brightness-old)*.045;
      }
    }
    const mask=new Uint8Array(cols*rows);
    let changedCells=0;
    for(let cy=0;cy<rows;cy++)for(let cx=0;cx<cols;cx++){
      const cellW=Math.min(cell,width-cx*cell),cellH=Math.min(cell,height-cy*cell);
      const index=cy*cols+cx;
      if(counts[index]>=Math.max(5,Math.ceil(cellW*cellH*.16))){mask[index]=1;changedCells++;}
    }
    this.cameraMoved=changedCells > cols*rows*.48;
    if(this.cameraMoved) return [];
    // Join very small gaps inside objects without dilating the entire image.
    const joined=mask.slice();
    for(let y=1;y<rows-1;y++)for(let x=1;x<cols-1;x++){
      const i=y*cols+x;
      if(!mask[i] && ((mask[i-1]&&mask[i+1])||(mask[i-cols]&&mask[i+cols])))joined[i]=1;
    }
    const visited=new Uint8Array(cols*rows),regions=[];
    for(let start=0;start<joined.length;start++){
      if(!joined[start]||visited[start])continue;
      const queue=[start];visited[start]=1;
      let minX=cols,minY=rows,maxX=0,maxY=0,area=0;
      for(let head=0;head<queue.length;head++){
        const i=queue[head],x=i%cols,y=i/cols|0;
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);area++;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;
          if(nx<0||nx>=cols||ny<0||ny>=rows)continue;
          const ni=ny*cols+nx;
          if(joined[ni]&&!visited[ni]){visited[ni]=1;queue.push(ni);}
        }
      }
      if(area<2)continue;
      const pad=3;
      const x=Math.max(0,minX*cell-pad),y=Math.max(0,minY*cell-pad);
      const right=Math.min(width,(maxX+1)*cell+pad),bottom=Math.min(height,(maxY+1)*cell+pad);
      // Filter one-pixel/noise and unrealistic whole-frame regions.
      if((right-x)*(bottom-y)<width*height*.008)continue;
      regions.push({x,y,w:right-x,h:bottom-y,area});
    }
    return regions.sort((a,b)=>b.area-a.area).slice(0,12);
  }
}
