const length=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const cross=(a,b)=>a[0]*b[2]-a[2]*b[0];
export function drivingRoute(points,widths){
  const p=[],w=[];
  for(let i=0;i<points.length;i++)if(!i||length(points[i],p.at(-1))>.01){if(p.length)w.push(widths[i-1]);p.push(points[i]);}
  if(p.length<2||w.some(v=>!Number.isFinite(v)||v<4.8))return [];
  const dirs=p.slice(1).map((b,i)=>{const a=p[i],d=length(a,b);return [(b[0]-a[0])/d,0,(b[2]-a[2])/d];});
  const offset=(v,i)=>{const d=dirs[i],lanes=Math.max(1,Math.floor(w[i]/2/3.5)),s=w[i]/(4*lanes);return [v[0]-d[2]*s,v[1],v[2]+d[0]*s];};
  const vertices=[offset(p[0],0)];
  for(let i=1;i<p.length-1;i++){
    const a=offset(p[i],i-1),b=offset(p[i],i),u=dirs[i-1],v=dirs[i],den=cross(u,v);
    if(u[0]*v[0]+u[2]*v[2]<-.8)return [];
    if(Math.abs(den)<.001){vertices.push(mix(a,b,.5));continue;}
    const t=cross(b.map((x,j)=>x-a[j]),v)/den;
    if(Math.abs(t)>Math.max(w[i-1],w[i])*2)return [];
    vertices.push([a[0]+u[0]*t,p[i][1],a[2]+u[2]*t]);
  }vertices.push(offset(p.at(-1),dirs.length-1));
  const result=[vertices[0]];
  function line(b){const a=result.at(-1),n=Math.ceil(length(a,b));for(let j=1;j<=n;j++)result.push(mix(a,b,j/n));}
  for(let i=1;i<vertices.length-1;i++){
    const a=vertices[i-1],b=vertices[i],c=vertices[i+1],before=length(a,b),after=length(b,c);
    if(before<.01||after<.01)continue;
    const cut=Math.min(w[i-1]/2,w[i]/2,before*.4,after*.4),entry=mix(b,a,cut/before),exit=mix(b,c,cut/after);
    line(entry);const n=Math.max(4,Math.ceil(cut*3));
    for(let j=1;j<=n;j++){const t=j/n;result.push(mix(mix(entry,b,t),mix(b,exit,t),t));}
  }line(vertices.at(-1));return result;
}
