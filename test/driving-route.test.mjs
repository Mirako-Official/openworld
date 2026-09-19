import test from 'node:test';
import assert from 'node:assert/strict';
import {drivingRoute} from '../shared/driving-route.mjs';
import {createRoadNavigator} from '../shared/navigation.mjs';
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
test('right hand lanes reverse sides with direction and preserve road elevation',()=>{
  const a=drivingRoute([[0,4,0],[0,8,-100]],[12]),b=drivingRoute([[0,8,-100],[0,4,0]],[12]);
  assert.equal(a[0][0],3);assert.equal(b[0][0],-3);assert.equal(a.at(-1)[1],8);
  assert.deepEqual(drivingRoute([[0,0,0],[0,0,50]],[3]),[]);
  assert.equal(drivingRoute([[0,4,0],[0,4,-100]],[16])[0][0],2);
});
test('intersection curves stay inside roads and connect the correct exit lane',()=>{
  for(const side of [-1,1]){
    const p=drivingRoute([[0,4,0],[0,4,-50],[side*50,4,-50]],[12,12]);
    assert.equal(p[0][0],3);assert.equal(p.at(-1)[2],-50+side*3);
    assert.ok(p.length>30);let turn=0;
    for(let i=1;i<p.length-1;i++){
      assert.ok(Math.abs(p[i][0])<=4.85||Math.abs(p[i][2]+50)<=4.85,'car footprint leaves road');
      const a=p[i-1],b=p[i],c=p[i+1],x=Math.atan2(b[0]-a[0],b[2]-a[2]),y=Math.atan2(c[0]-b[0],c[2]-b[2]);
      turn=Math.max(turn,Math.abs(Math.atan2(Math.sin(y-x),Math.cos(y-x))));
      assert.ok(dist(a,b)<=1.1);
    }assert.ok(turn<.45);
  }
});
test('navigator retains walking route but supplies width-aware driving lanes',()=>{
  const n=createRoadNavigator([{id:'a',width:8,points:[[0,4,0],[0,4,-100]]}]);
  const r=n.route({x:0,z:-5},{x:0,z:-80});assert.equal(r.points[0][0],0);assert.equal(r.drivingPoints[0][0],2);
});
