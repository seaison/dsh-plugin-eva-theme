/** 验证真实 apply() 注册的路由、并发合并、超时恢复和卸载取消，不联网或调用播放器。 */
import assert from "node:assert/strict";
import { PassThrough, Readable } from "node:stream";
import { EventEmitter } from "node:events";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { apply } from "../lib/index.js";
import { BALANCE_PATH } from "../lib/host-balance.mjs";
import { CONTROL_PATH, NOWPLAYING_PATH } from "../lib/host-nowplaying.mjs";
const mount = (available) => {
	const routes = new Map(), disposers = [];
	const scope = {
		webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } },
		credentials: { resolve: async () => ({ value: "test-credential" }) },
		effect(fn) { const dispose=fn();disposers.push(dispose);return dispose; },
	};
	apply({ inject(deps, run) { if(deps.every(dep=>available.includes(dep)))run(scope); } });
	return { routes, dispose() { for(const fn of disposers.reverse()) fn(); } };
};
const request = async (route, method="GET", body) => {
	const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
	Object.assign(req,{method,url:route.path,headers:{host:"localhost:1234",origin:"http://localhost:1234"}});
	const response={status:null,text:"",writeHead(status){this.status=status},end(text){this.text=text||""}};
	await route.handler(req,response);
	return {...response,body:response.text?JSON.parse(response.text):null};
};
const sleep=()=>new Promise(resolve=>setTimeout(resolve,0));
const realFetch=globalThis.fetch, realTimeout=AbortSignal.timeout;
const realExec=childProcess.execFile, realSpawn=childProcess.spawn, realPlatform=Object.getOwnPropertyDescriptor(process,"platform");
let checks=0;
try {
	const musicOnly=mount(["webServer"]);
	assert(musicOnly.routes.has(NOWPLAYING_PATH));assert(musicOnly.routes.has(CONTROL_PATH));assert(!musicOnly.routes.has(BALANCE_PATH));checks+=3;
	const badAction=await request(musicOnly.routes.get(CONTROL_PATH),"POST",{action:"__proto__"});
	assert.equal(badAction.status,400);assert.equal(badAction.body.code,"ACTION");checks+=2;
	musicOnly.dispose();

	// 替换进程桥，测试绝不运行 osascript 或操作用户播放器。
	Object.defineProperty(process,"platform",{configurable:true,value:"darwin"});
	const osaCalls=[];
	let media={ok:true,source:"system",bundleId:"com.netease.163music",app:"网易云音乐",playing:true,state:"playing",title:"Before",duration:240,position:10};
	let controlResult={ok:true},holdRead=false,releaseRead;
	childProcess.execFile=(command,args,_options,callback)=>{
		assert.equal(command,"osascript");osaCalls.push(args);
		const result=JSON.stringify(args[3]==="read"?{...media}:controlResult);
		if(args[3]==="read"&&holdRead){holdRead=false;releaseRead=()=>callback(null,result);}
		else queueMicrotask(()=>callback(null,args[0]==="-e"?"ok":result));
		return {};
	};
	syncBuiltinESMExports();
	const player=mount(["webServer"]),control=player.routes.get(CONTROL_PATH),now=player.routes.get(NOWPLAYING_PATH);
	let result=await request(control,"POST",{action:"next",app:media.app,bundleId:media.bundleId});
	assert.equal(result.status,200);assert.equal(osaCalls.length,1);assert.deepEqual(osaCalls[0].slice(3),["next",media.bundleId]);checks+=3;
	controlResult={ok:false,code:"SOURCE_CHANGED"};const beforeChanged=osaCalls.length;
	result=await request(control,"POST",{action:"playpause",bundleId:media.bundleId});
	assert.equal(result.status,409);assert.equal(result.body.code,"SOURCE_CHANGED");assert.equal(osaCalls.length,beforeChanged+1);checks+=3;
	const beforeInvalid=osaCalls.length;
	result=await request(control,"POST",{action:"next",bundleId:"$(bad)"});
	assert.equal(result.status,400);assert.equal(osaCalls.length,beforeInvalid);checks+=2;
	controlResult={ok:true};holdRead=true;
	const oldRead=request(now),sameRead=request(now);await sleep();const beforeControl=osaCalls.length;
	assert.equal(typeof releaseRead,"function");checks++;
	await request(control,"POST",{action:"next",bundleId:media.bundleId});
	media={...media,title:"After"};
	const freshRead=await request(now);
	assert.equal(freshRead.body.title,"After");assert.equal(osaCalls.length,beforeControl+2);checks+=2;
	releaseRead();await Promise.all([oldRead,sameRead]);
	assert.equal((await request(now)).body.title,"After");assert.equal(osaCalls.length,beforeControl+2);checks+=2;
	controlResult={ok:false,code:"CONTROL_UNAVAILABLE"};media={...media,app:"Music",bundleId:"com.apple.Music"};const beforeFallback=osaCalls.length;
	result=await request(control,"POST",{action:"playpause",app:media.app,bundleId:media.bundleId});
	assert.equal(result.status,200);assert.equal(osaCalls.length,beforeFallback+3);
	assert.deepEqual(osaCalls.slice(beforeFallback).map(args=>args[0]==="-e"?"native":args[3]),["playpause","read","native"]);checks+=3;
	player.dispose();childProcess.execFile=realExec;syncBuiltinESMExports();Object.defineProperty(process,"platform",realPlatform);

	Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
	const readers = [], controls = [];
	let controlCode = null;
	childProcess.spawn = (program, args, options) => {
		assert.match(program, /WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
		assert.deepEqual(args.slice(-2), ["-Mode", "read"]);
		assert.equal(options.windowsHide, true);
		const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), killed: false });
		proc.kill = () => { proc.killed = true; proc.emit("exit"); };
		readers.push(proc);
		return proc;
	};
	childProcess.execFile = (program, args, options, callback) => {
		assert.match(program, /powershell\.exe$/i);
		controls.push({ args, signal: options.signal });
		queueMicrotask(() => callback(null, JSON.stringify(controlCode ? { ok: false, code: controlCode } : { ok: true })));
		return {};
	};
	syncBuiltinESMExports();
	const windows = mount(["webServer"]);
	const winRead = windows.routes.get(NOWPLAYING_PATH), winControl = windows.routes.get(CONTROL_PATH);
	assert.equal(readers.length, 0);
	assert.deepEqual((await request(winRead)).body, { ok: true, supported: true, app: null, playing: false, sources: [] });
	assert.equal(readers.length, 1); checks += 3;
	const netEase = { aumid: "netease:cloudmusic.exe", source: "netease", status: "Paused", title: "网易云曲目" };
	const aumid = "C:\\Program Files\\VLC\\vlc.exe";
	const vlc = { aumid, source: "smtc", status: "Playing", title: "当前音乐", duration: 240, position: 18 };
	const wire = Buffer.from(JSON.stringify({ ok: true, sources: [netEase, vlc, { ...vlc }, { ...vlc, aumid: "closed.exe", status: "Closed" }] }) + "\r\n");
	const cut = wire.indexOf(Buffer.from("当")) + 1;
	readers[0].stdout.write(wire.subarray(0, cut));
	assert.equal((await request(winRead)).body.app, null);
	readers[0].stdout.write(wire.subarray(cut));
	const snapshot = (await request(winRead)).body;
	assert.equal(snapshot.title, "当前音乐");
	assert.equal(snapshot.duration, 240);
	assert.deepEqual(snapshot.sources.map(source => source.app), ["网易云音乐", "VLC"]);
	assert.equal(readers.length, 1); checks += 5;
	for (const [id, status] of [["abc\n-def", 400], [undefined, 400], ["unrelated.exe", 409]]) {
		assert.equal((await request(winControl, "POST", { action: "next", bundleId: id })).status, status); checks++;
	}
	assert.equal(controls.length, 0);
	assert.equal((await request(winControl, "POST", { action: "next", app: "VLC", bundleId: aumid })).status, 200);
	assert.deepEqual(controls[0].args.slice(-4), ["-Mode", "next", "-SourceId", Buffer.from(aumid).toString("base64")]);
	controlCode = "SOURCE_CHANGED";
	assert.equal((await request(winControl, "POST", { action: "playpause", bundleId: netEase.aumid })).status, 409);
	windows.dispose();
	assert.equal(readers[0].killed, true);
	assert.equal(controls[0].signal.aborted, true);
	const reloaded = mount(["webServer"]);
	await request(reloaded.routes.get(NOWPLAYING_PATH));
	assert.equal(readers.length, 2);
	reloaded.dispose(); checks += 7;
	childProcess.spawn = realSpawn; childProcess.execFile = realExec;
	syncBuiltinESMExports(); Object.defineProperty(process, "platform", realPlatform);

	const host=mount(["webServer","credentials"]), route=host.routes.get(BALANCE_PATH);
	let timeoutController=new AbortController(),calls=0,lastSignal;
	AbortSignal.timeout=()=>timeoutController.signal;
	globalThis.fetch=async(_url,{signal})=>{
		calls++;lastSignal=signal;
		return new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}));
	};
	const first=request(route),second=request(route);await sleep();
	assert.equal(calls,1);checks++;
	timeoutController.abort(new DOMException("Test deadline","TimeoutError"));
	for(const result of await Promise.all([first,second])) { assert.equal(result.body.code,"TIMEOUT");checks++; }
	timeoutController=new AbortController();
	globalThis.fetch=async()=>({ok:true,json:async()=>({balance_infos:[{currency:"CNY",total_balance:"12.34"}]})});
	const recovered=await request(route);
	assert.equal(recovered.body.balance,12.34);assert.equal(recovered.body.ok,true);checks+=2;
	assert(!JSON.stringify(recovered).includes("test-credential"));checks++;
	assert.equal((await request(route,"HEAD")).text,"");checks++;
	assert.equal((await request(route,"POST")).status,405);checks++;
	host.dispose();assert.equal(host.routes.size,0);checks++;

	const fresh=mount(["webServer","credentials"]);
	globalThis.fetch=async(_url,{signal})=>{lastSignal=signal;return new Promise((_r,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}));};
	const pending=request(fresh.routes.get(BALANCE_PATH));await sleep();fresh.dispose();
	await pending;assert.equal(lastSignal.aborted,true);assert.equal(fresh.routes.size,0);checks+=2;
	console.log(`✓ 宿主路由测试通过（${checks} 项：媒体快速控制 / 来源保护 / 旧缓存隔离 / 并发 / 超时 / 卸载）`);
} finally { globalThis.fetch=realFetch;AbortSignal.timeout=realTimeout;childProcess.execFile=realExec;childProcess.spawn=realSpawn;syncBuiltinESMExports();Object.defineProperty(process,"platform",realPlatform); }
