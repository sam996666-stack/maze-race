const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const QRCode=require('qrcode');
const crypto=require('crypto');
const app=express();const server=http.createServer(app);const io=new Server(server,{cors:{origin:false}});
app.use(express.static('public'));
const rooms=new Map();
const LIMIT=50, SIZE=21;
function maze(seed){let a=Array.from({length:SIZE},()=>Array(SIZE).fill(1));let s=seed>>>0;const rand=()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);let stack=[[1,1]];a[1][1]=0;while(stack.length){let [x,y]=stack[stack.length-1],opts=[[2,0],[-2,0],[0,2],[0,-2]].filter(([dx,dy])=>{let nx=x+dx,ny=y+dy;return nx>0&&ny>0&&nx<SIZE-1&&ny<SIZE-1&&a[ny][nx]===1});if(!opts.length){stack.pop();continue}let [dx,dy]=opts[Math.floor(rand()*opts.length)];a[y+dy/2][x+dx/2]=0;a[y+dy][x+dx]=0;stack.push([x+dx,y+dy])}return a}
function snapshot(r){return {code:r.code,status:r.status,hostId:r.hostId,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,finished:p.finished,elapsed:p.elapsed})),startAt:r.startAt,maze:r.status==='waiting'?null:r.grid,finish:{x:SIZE-2,y:SIZE-2}}}
function emit(r){io.to(r.code).emit('state',snapshot(r))}
app.get('/api/qr/:code',async(req,res)=>{let code=req.params.code.toUpperCase();if(!rooms.has(code))return res.sendStatus(404);const url=`${req.protocol}://${req.get('host')}/?room=${encodeURIComponent(code)}`;res.type('png').send(await QRCode.toBuffer(url,{width:360,margin:2,color:{dark:'#0a1020',light:'#ffffff'}}))});
io.on('connection',socket=>{
 socket.on('create',(_,cb)=>{let code;do{code=crypto.randomBytes(3).toString('hex').toUpperCase()}while(rooms.has(code));let r={code,hostId:socket.id,status:'waiting',players:new Map(),grid:null,startAt:null};rooms.set(code,r);socket.join(code);socket.data.code=code;socket.data.host=true;cb({ok:true,code});emit(r)});
 socket.on('join',({code,name},cb)=>{code=String(code||'').trim().toUpperCase();let r=rooms.get(code);if(!r)return cb({error:'找不到房間'});if(r.status!=='waiting')return cb({error:'比賽已開始，請等下一場'});if(r.players.size>=LIMIT)return cb({error:'房間已滿（50 人）'});name=String(name||'').trim().slice(0,16);if(!name)return cb({error:'請輸入暱稱'});if(socket.data.code)return cb({error:'請重新整理頁面再加入'});r.players.set(socket.id,{id:socket.id,name,x:1,y:1,finished:false,elapsed:null,lastMove:0});socket.join(code);socket.data.code=code;cb({ok:true,code,id:socket.id});emit(r)});
 socket.on('start',(_,cb)=>{let r=rooms.get(socket.data.code);if(!r||r.hostId!==socket.id)return cb?.({error:'只有主持人可以開始'});if(r.status!=='waiting')return cb?.({error:'比賽已開始'});if(!r.players.size)return cb?.({error:'還沒有參賽者'});r.grid=maze(crypto.randomBytes(4).readUInt32BE());r.status='countdown';r.startAt=Date.now()+3500;for(let p of r.players.values()){p.x=1;p.y=1;p.finished=false;p.elapsed=null;p.lastMove=0}emit(r);cb?.({ok:true});setTimeout(()=>{if(rooms.get(r.code)===r&&r.status==='countdown'){r.status='playing';emit(r)}},3500)});
 socket.on('move',({dx,dy},cb)=>{let r=rooms.get(socket.data.code),p=r?.players.get(socket.id);if(!r||!p||r.status!=='playing'||p.finished||Date.now()<r.startAt)return;dx=Number(dx);dy=Number(dy);if(!Number.isInteger(dx)||!Number.isInteger(dy)||Math.abs(dx)+Math.abs(dy)!==1)return;let now=Date.now();if(now-p.lastMove<75)return;p.lastMove=now;let x=p.x+dx,y=p.y+dy;if(!r.grid[y]||r.grid[y][x]!==0)return;p.x=x;p.y=y;socket.emit('position',{x,y});if(x===SIZE-2&&y===SIZE-2){p.finished=true;p.elapsed=now-r.startAt;emit(r);if([...r.players.values()].every(v=>v.finished)){r.status='finished';emit(r)}}});
 socket.on('reset',(_,cb)=>{let r=rooms.get(socket.data.code);if(!r||r.hostId!==socket.id)return cb?.({error:'無權限'});r.status='waiting';r.grid=null;r.startAt=null;for(let p of r.players.values()){p.finished=false;p.elapsed=null;p.x=1;p.y=1}emit(r);cb?.({ok:true})});
 socket.on('disconnect',()=>{let r=rooms.get(socket.data.code);if(!r)return;if(r.hostId===socket.id){io.to(r.code).emit('closed');rooms.delete(r.code);return}r.players.delete(socket.id);emit(r)})
});
server.listen(process.env.PORT||3000,()=>console.log('Maze Race listening'));
