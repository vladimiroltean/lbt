#!/usr/bin/env node

var fs = require("fs");
var http = require("http");
var sshClient = require("ssh2").Client;
var server = http.createServer();
var url = require("url");
var port = 8000;
var html = readPlaintextFromFile("index.html", true);
var blt_client_js = readPlaintextFromFile("js/blt-client.js", true);
var spawn = require("child_process").spawn;
var sse;
var state;

function onHttpRequest(request, response) {
	switch (request.method) {
	case "GET":
		console.log("GET " + request.url);
		switch (request.url) {
		/* Files */
		case "/":
		case "/index.html":
			response.setHeader("Content-Type", "text/html");
			response.end(html);
			break;
		case "/js/blt-client.js":
			response.setHeader("Content-Type", "application/javascript");
			response.end(blt_client_js);
			break;
		/* REST method calls */
		case "/flows":
			response.setHeader("Content-Type", "application/json");
			response.end(curateStateForSend(state));
			break;
		case "/running":
			response.setHeader("Content-Type", "application/json");
			response.end(JSON.stringify({ running: state.running }));
			break;
		default:
			httpLogErr(response, 404, "invalid url " + request.url);
			break;
		}
		break;
	case "PUT":
		console.log("PUT " + request.url);
		switch (request.url) {
		/* Only REST method calls */
		case "/flows":
			if (state.running == true) {
				httpLogErr(response, 405,
				           "Flow config changes not allowed while traffic is running");
				break;
			}
			request.on("data", function onData(data) {
				createNewState(data)
				.then((newState) => {
					state = newState;
					var flows = curateStateForSend(state);
					response.setHeader("Content-Type", "application/json");
					response.end(flows);
					fs.writeFile("flows.json", flows, function onWrite() {
						console.log("Successfully written flows to file.");
					});
				})
				.catch((reason) => {
					httpLogErr(response, 400, "cannot parse flows from " + data);
				});
			});
			break;
		case "/running":
			request.on("data", function onData(data) {
				try {
					var msg = JSON.parse(data);
					onStartStopTraffic(msg.running);
					response.setHeader("Content-Type", "application/json");
					response.end(JSON.stringify({ running: state.running }));
				} catch (e) {
					httpLogErr(response, 400, e + ": invalid request body " + data);
				}
			});
			break;
		default:
			httpLogErr(response, 405, "invalid url for PUT: " + request.url);
			break;
		}
		break;
	default:
		httpLogErr(response, 405, "Unknown method called: " + request.method);
		break;
	}
}

function httpLogErr(response, statusCode, text) {
	response.setHeader("Content-Type", "text/plain");
	response.statusCode = statusCode;
	response.end(text);
}

/* this == f->clientConn */
function onIperfClientConnReady() {
	var flow = this.backlink;
	var iperfCmd = "iperf3 -J -p " + flow.port + " -c " + flow.destination.split("@")[1];

	console.log("iperf Client for %s :: conn ready", flow.label);
	this.exec(iperfCmd, { pty: true }, (err, stream) => {
		if (err) throw err;
		stream.on("close", (code, signal) => {
			console.log("iperf Client for %s :: close :: code: %s, signal: %s", flow.label, code, signal);
			this.end();
		});
		stream.on("data", (data) => {
			console.log("%s Client STDOUT: %s", flow.label, data);
		});
		stream.stderr.on("data", (data) => {
			console.log("%s Client STDERR: %s", flow.label, data);
		});
	});
}

/* this == f->serverConn */
function onIperfServerConnReady() {
	var flow = this.backlink;
	var iperfCmd = "iperf3 -1 -f m -i 0.5 -s -p " + flow.port;

	console.log("iperf Server for %s :: conn ready", flow.label);
	this.exec(iperfCmd, { pty: true }, (err, stream) => {
		if (err) throw err;
		stream.on("close", (code, signal) => {
			console.log("iperf Server for %s :: close :: code: %s, signal: %s", flow.label, code, signal);
			this.end();
		});
		stream.on("data", (data) => {
			if (data.includes("Server listening on " + flow.port)) {
				/* iPerf Server managed to start up.
				 * Time to connect to iPerf client and start
				 * that up as well.
				 */
				flow.clientConn.connect(flow.clientConn.config);
			} else if (data.includes("Mbits/sec")) {
				var arr = data.toString().trim().split(/\ +/);
				var bw = arr[arr.indexOf("Mbits/sec") - 1];
				var time = arr[arr.indexOf("sec") - 1].split("-")[0];
				flow.data[time] = bw;
				/* Plot an extra iperf point */
				state.iperfPlotter.stdin.write(time + " " + flow.label + " " + bw + "\n");
			} else {
				console.log("%s Server STDOUT: %s", flow.label, data);
			}
		});
		stream.stderr.on("data", (data) => {
			console.log("%s Server STDERR: %s", flow.label, data);
		});
	});
}

function onGnuplotData(data, flowType) {
	var plotter = (flowType == "iperf") ? state.iperfPlotter :
	              (flowType == "ping") ? state.pingPlotter :
	              undefined;
	if (data.toString().includes("</svg>")) {
		/* New SVG can be reassembled. */
		var halves = data.toString().split("</svg>");
		plotter.svg += halves[0] + "</svg>";
		/* Send it to the SSE clients */
		state.clients.forEach((stream) => {
			stream.send(flowType, JSON.stringify({ svg: plotter.svg }));
		});
		/* Re-initialize the svg with the remainder */
		plotter.svg = halves[1];
	} else {
		plotter.svg += data;
	}
}

function startIperfTraffic(iperfFlows) {
	iperfFlows.forEach((f) => {
		var srcArr = f.source.split("@");
		var dstArr = f.destination.split("@");

		f.clientConn = new sshClient();
		f.clientConn.backlink = f;
		f.clientConn.on("ready", onIperfClientConnReady);
		f.clientConn.on("error", (e) => {
			console.log("SSH connection error: " + e);
			stopTraffic();
		});
		f.clientConn.config = {
			username: srcArr[0],
			host: srcArr[1],
			port: 22,
			privateKey: fs.readFileSync(".ssh/id_rsa")
		};
		/* f.clientConn does not connect now */

		f.serverConn = new sshClient();
		f.serverConn.backlink = f;
		f.serverConn.on("ready", onIperfServerConnReady);
		f.serverConn.on("error", (e) => {
			console.log("SSH connection error: " + e);
			stopTraffic();
		});
		f.serverConn.config = {
			username: dstArr[0],
			host: dstArr[1],
			port: 22,
			privateKey: fs.readFileSync(".ssh/id_rsa")
		};
		f.serverConn.connect(f.serverConn.config);
		f.data = {};
	});
	var iperfParams = [
		"--stream", "0.5",
		"--domain",
		"--dataid",
		"--exit",
		"--lines",
		"--ymin", 0,
		//"--ymax", 1000,
		"--autolegend",
		/* XXX @host1 */
		"--style", "host1", 'linewidth 2 linecolor rgb "blue"',
		"--style", "host2", 'linewidth 2 linecolor rgb "green"',
		/* "--timefmt", "%H:%M:%S", "--set", 'format x "%H:%M:%S"', */
		"--xlen", "30",
		"--xlabel", "Time",
		"--ylabel", "Bandwidth",
		"--title", "Peanut butter",
		"--terminal", "svg"
	];
	state.iperfPlotter = spawn("feedgnuplot", iperfParams);
	state.iperfPlotter.stdout.on("data", (data) => onGnuplotData(data, "iperf"));
	state.iperfPlotter.stderr.on("data", (data) => {
		console.log("feedgnuplot stderr: %s", data);
	});
	state.iperfPlotter.on("exit", (code) => {
		console.log("feedgnuplot process exited with code %s", code);
	});
	state.iperfPlotter.svg = "";
}

function startPingTraffic(pingFlows) {
	pingFlows.forEach((f) => {
		var srcArr = f.source.split("@");

		f.clientConn = new sshClient();
		f.clientConn.backlink = f;
		f.clientConn.on("ready", onPingClientConnReady);
		f.clientConn.on("error", (e) => {
			console.log("SSH connection error: " + e);
			stopTraffic();
		});
		f.clientConn.config = {
			username: srcArr[0],
			host: srcArr[1],
			port: 22,
			privateKey: fs.readFileSync(".ssh/id_rsa")
		};
		f.clientConn.connect(f.clientConn.config);
		f.data = {};
	});
	var pingParams = [
		"--stream", "0.5",
		"--domain",
		"--dataid",
		"--exit",
		"--lines",
		"--ymin", 0,
		"--ymax", 1000,
		"--autolegend",
		/* XXX @host1 */
		"--style", "host1", 'linewidth 2 linecolor rgb "blue"',
		"--style", "host2", 'linewidth 2 linecolor rgb "green"',
		/* "--timefmt", "%H:%M:%S", "--set", 'format x "%H:%M:%S"', */
		"--xlen", "30",
		"--xlabel", "Time",
		"--ylabel", "Bandwidth",
		"--title", "Peanut butter",
		"--terminal", "svg"
	];
	return;
	state.iperfPlotter = spawn("feedgnuplot", iperfParams);
	state.iperfPlotter.stdout.on("data", (data) => onGnuplotData(data, "iperf"));
	state.iperfPlotter.stderr.on("data", (data) => {
		console.log("feedgnuplot stderr: %s", data);
	});
	state.iperfPlotter.on("exit", (code) => {
		console.log("feedgnuplot process exited with code %s", code);
	});
	state.iperfPlotter.svg = "";
}

function startTraffic() {
	var enabledFlows = {
		iperf: state.flows.iperf.filter((e) => { return e.enabled }),
		ping:  state.flows.ping.filter( (e) => { return e.enabled })
	};
	startIperfTraffic(enabledFlows.iperf);
	startPingTraffic(enabledFlows.ping);
	state.running = true;
	state.clients = [];
}

function stopTraffic() {
	var enabledFlows = {
		iperf: state.flows.iperf.filter((e) => { return e.enabled }),
		ping:  state.flows.ping.filter( (e) => { return e.enabled })
	};
	enabledFlows.iperf.forEach((f) => {
		if (typeof(f.clientConn) != "undefined") { f.clientConn.end() };
		if (typeof(f.serverConn) != "undefined") { f.serverConn.end() };
	});
	enabledFlows.ping.forEach((f) => {
		if (typeof(f.clientConn) != "undefined") { f.clientConn.end() };
	});
	state.iperfPlotter.stdin.end();
	/* XXX */
	//state.pingPlotter.stdin.end();
	state.clients.forEach((stream) => {
		stream.close();
	});
	state.clients = [];
	state.running = false;
}

function onStartStopTraffic(newTrafficState) {
	console.log("traffic start/stop: old state " + state.running + ", new state " + newTrafficState);
	if (newTrafficState == state.running) {
		/* This can happen when server restarted, but client
		 * has stale information about its state. */
		return;
	}
	switch (newTrafficState) {
	case true:
		startTraffic();
		break;
	case false:
		stopTraffic();
		break;
	default:
		throw new Error("undefined traffic state");
	}
}

function onHttpListen() {
	console.log("Server listening for http requests on port " + port);
	/* initialize the /sse route */
	SSE = require("sse");
	sse = new SSE(server);

	sse.on("connection", (stream) => {
		console.log("sse :: established new connection to %s",
		            stream.res.connection.remoteAddress);
		state.clients.push(stream);
		stream.on("close", () => {
			state.clients.splice(state.clients.indexOf(stream), 1);
			console.log("sse :: closed connection to %s",
			            stream.res.connection.remoteAddress);
		});
	});
}

function onHttpServerError(e) {
	console.log(e.name + ": " + e.message);
}

function onExit() {
	console.log("Server exiting");
	process.exit();
}

function readPlaintextFromFile(filename, exitOnFail) {
	var content = "";
	try {
		content = fs.readFileSync(filename, "utf-8");
	} catch (e) {
		console.log(e.name + ": " + e.message);
		if (exitOnFail) {
			console.log("Cannot read file, exiting");
			process.exit(1);
		}
	}
	return content;
}

/*
 * state = {
 *     running: boolean,
 *     clients: [Client],
 *     iperfPlotter: ChildProcess,
 *     pingPlotter: ChildProcess,
 *     flows: {
 *         iperf: [
 *             {
 *                 source: "user@host",
 *                 destination: "user@host",
 *                 port: integer,
 *                 transport: "tcp|udp",
 *                 bandwidth: integer,
 *                 enabled: boolean,
 *                 label: string,
 *                 data: [number],
 *             }, (...)
 *         ],
 *         ping: [
 *             {
 *                 source: "user@host",
 *                 destination: "user@host",
 *                 intervalType: "periodic|adaptive|flood",
 *                 intervalMS: integer,
 *                 enabled: boolean,
 *                 label: string,
 *                 data: []
 *             }, (...)
 *         ]
 *     }
 * };
 */

/* We create a new state object from the given flowsString
 * interpreted as JSON.
 * state.running always gets initialized as false, because
 * it is not semantically correct anyway to call this function
 * while running == true.
 */
function createNewState(flowsString) {
	return new Promise((resolve, reject) => {
		try {
			var newFlows = JSON.parse(flowsString);
			resolve({
				running: false,
				clients: [],
				flows: newFlows.flows
			});
		} catch (e) {
			reject(e);
		}
	});
}

/* The reason we start creating this from scratch is that
 * we put a lot of extraneous stuff in the state, such as data,
 * plotter, clientConn, serverConn, that we don't want to leak
 */
function curateStateForSend(state) {
	var newFlows = { iperf: [], ping: [] };
	state.flows.iperf.forEach((f) => {
		newFlows.iperf.push({
			source: f.source,
			destination: f.destination,
			port: f.port,
			transport: f.transport,
			bandwidth: f.bandwidth,
			enabled: f.enabled,
			label: f.label
		});
	});
	state.flows.ping.forEach((f) => {
		newFlows.ping.push({
			source: f.source,
			destination: f.destination,
			intervalType: f.intervalType,
			intervalMS: f.intervalMS,
			enabled: f.enabled,
			label: f.label
		});
	});
	return JSON.stringify(newFlows);
}

process.on("SIGHUP",  onExit);
process.on("SIGINT",  onExit);
process.on("SIGTERM", onExit);
process.on("SIGABRT", onExit);
process.on("SIGQUIT", onExit);

createNewState(readPlaintextFromFile("flows.json", false))
.then((newState) => {
	state = newState;
})
.catch((reason) => {
	console.log("initializing with empty iperf and ping flows array");
	state = {
		running: false,
		clients: [],
		iperfPlotter: {},
		pingPlotter: {},
		flows: {
			iperf: [],
			ping: []
		}
	};
});

server.on("request", onHttpRequest);
server.on("error", onHttpServerError);
server.listen(port, onHttpListen);
