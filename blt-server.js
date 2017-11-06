#!/usr/bin/env node

var fs = require("fs");
var http = require("http");
var sshClient = require("ssh2").Client;
var server = http.createServer();
var url = require("url");
var port = 8000;
var html = readPlaintextFromFile("index.html", true);
var blt_client_js = readPlaintextFromFile("js/blt-client.js", true);
var { spawn, execSync } = require("child_process");
var uuidv4 = require('uuid/v4');
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
				try {
					state = createNewState(data);
					var flowsString = curateStateForSend(state);
					/* Send flows back to client, as
					 * part of confirmation */
					response.setHeader("Content-Type", "application/json");
					response.end(flowsString);
					fs.writeFile("flows.json", flowsString, function onWrite() {
						console.log("Successfully written flows to file.");
					});
				} catch (reason) {
					httpLogErr(response, 400, "cannot parse flows from " + data + ", reason: " + reason);
				}
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
	console.log("httpLogErr :: " + text);
	response.setHeader("Content-Type", "text/plain");
	response.statusCode = statusCode;
	response.end(text);
}

/* Method of objects from the state.flows.iperf array */
function onSourceSSHConnReady(flowType) {
	var cmd;

	if (flowType == "iperf") {
		/* Run for 24 hours */
		cmd = "iperf3 -t 86400 -p " + this.port + " -c " + this.destination.hostname;
	} else {
		cmd = "ping -A " + this.destination.hostname;
	}

	this.startTime = Date.now();
	console.log("%s %s Client :: conn ready", this.label, flowType);
	this.srcSSHConn.exec(cmd, { pty: true }, (err, stream) => {
		if (err) {
			console.log(err);
			this.srcSSHConn.end();
			stopTraffic();
			return;
		}
		stream.on("close", (code, signal) => {
			console.log("%s %s Source :: close :: code: %s, signal: %s",
			            this.label, flowType, code, signal);
			this.srcSSHConn.end();
		});
		stream.on("data", (data) => {
			if (flowType == "ping") {
				stream.on("data", (data) => {
					if (data.includes("ms")) {
						var words = data.toString().trim().split(/\ +/);
						var rtt = words[words.indexOf("ms") - 1].split("=")[1];
						var time = (Date.now() - this.startTime) / 1000;
						/* Plot an extra ping point */
						state.plotter.ping.stdin.write(time + " " + this.id + " " + rtt + "\n");
					} else {
						console.log("%s %s Source STDOUT: %s",
						            this.label, flowType, data);
					}
				});
			} else {
				/* iPerf3 reports are taken at destination */
				console.log("%s %s Source :: STDOUT: %s",
				            this.label, flowType, data);
			}
		});
		stream.stderr.on("data", (data) => {
			console.log("%s %s Source :: STDERR: %s",
			            this.label, flowType, data);
			this.srcSSHConn.end();
			stopTraffic();
		});
	});
}

/* Method of objects from the state.flows.iperf array */
function onDestinationSSHConnReady(flowType) {
	var cmd;

	if (flowType == "iperf") {
		cmd = "iperf3 -1 -f m -i 0.5 -s -p " + this.port;
	}
	/* Nothing happens with ping on destination side (at the moment) */

	console.log("%s %s Destination :: conn ready", this.label, flowType);
	this.dstSSHConn.exec(cmd, { pty: true }, (err, stream) => {
		if (err) {
			console.log(err);
			this.dstSSHConn.end();
			stopTraffic();
			return;
		}
		stream.on("close", (code, signal) => {
			console.log("%s %s Destination :: close :: code: %s, signal: %s",
			            this.label, flowType, code, signal);
			stopTraffic();
		});
		stream.on("data", (data) => {
			if (flowType == "iperf") {
				if (data.includes("Server listening on " + this.port)) {
					/* iPerf Server managed to start up.
					 * Time to connect to iPerf client and start
					 * that up as well.
					 */
					this.srcSSHConn.connect(this.srcSSHConn.config);
				} else if (data.includes("Mbits/sec")) {
					var arr = data.toString().trim().split(/\ +/);
					var bw = arr[arr.indexOf("Mbits/sec") - 1];
					var time = arr[arr.indexOf("sec") - 1].split("-")[0];
					this.data[time] = bw;
					/* Plot an extra iperf point */
					state.plotter[flowType].stdin.write(time + " " + this.id + " " + bw + "\n");
				} else {
					console.log("%s %s Destination STDOUT: %s",
					            this.label, flowType, data);
				}
			} else {
				/* Ping. Data is gathered in the source connection */
				console.log("%s %s Destination :: STDOUT: %s",
				            this.label, flowType, data);
			}
		});
		stream.stderr.on("data", (data) => {
			console.log("%s %s Destination :: STDERR: %s",
			            this.label, flowType, data);
			this.dstSSHConn.end();
			stopTraffic();
		});
	});
}

/* method of state.plotter.iperf and state.plotter.ping */
function onGnuplotData(flowType, data) {
	if (data.toString().includes("</svg>")) {
		/* New SVG can be reassembled. */
		var halves = data.toString().split("</svg>");
		this.svg += halves[0] + "</svg>";
		/* Send it to the SSE clients */
		state.clients.forEach((stream) => {
			stream.send(flowType, JSON.stringify({ svg: this.svg }));
		});
		/* Re-initialize the svg with the remainder */
		this.svg = halves[1];
	} else {
		this.svg += data;
	}
}

function startFlows(flows, flowType) {
	if (!flows.length) { return; }

	var feedgnuplotParams;
	
	if (flowType == "iperf") {
		feedgnuplotParams = [
			"--stream", "0.5",
			"--domain",
			"--dataid",
			"--exit",
			"--lines",
			"--ymin", 0,
			//"--ymax", 1000,
			/* "--timefmt", "%H:%M:%S", "--set", 'format x "%H:%M:%S"', */
			"--xlen", "30",
			"--xlabel", "Time (seconds)",
			"--ylabel", "Bandwidth (Mbps)",
			"--title", "iPerf3 Bandwidth",
			"--terminal", "svg"
		];
	} else {
		feedgnuplotParams = [
			"--stream", "0.5",
			"--domain",
			"--dataid",
			"--exit",
			"--lines",
			"--xmin", "0",
			//"--xmax", "50",
			"--xlen", "30",
			"--ymin", "0",
			"--xlabel", "RTT (ms)",
			"--ylabel", "Packets",
			"--title", "Ping Round Trip Time",
			"--binwidth", "0.2",
			"--terminal", "svg"
		];
	}

	flows.forEach((f) => {
		if (flowType == "iperf") {
			feedgnuplotParams.push("--style", f.id, 'linewidth 2');
			feedgnuplotParams.push("--legend", f.id, f.label);
		} else {
			feedgnuplotParams.push("--legend", f.id, f.label);
			feedgnuplotParams.push("--histogram", f.id);
		}

		f.srcSSHConn = new sshClient();
		f.srcSSHConn.on("ready", () => onSourceSSHConnReady.call(f, flowType));
		f.srcSSHConn.on("error", (e) => {
			console.log("SSH connection error: " + e);
			stopTraffic();
		});
		f.srcSSHConn.config = {
			username: f.source.user,
			host: f.source.hostname,
			port: f.source.port,
			privateKey: fs.readFileSync(".ssh/id_rsa")
		};
		if (flowType == "ping") {
			/* Ping traffic is initiated through the
			 * SSH connection to source.
			 */
			f.srcSSHConn.connect(f.srcSSHConn.config);
		} else if (flowType == "iperf") {
			/* iPerf traffic is initiated through the
			 * source SSH connection as well, but an iPerf
			 * server must first be started on the destination.
			 */
			f.dstSSHConn = new sshClient();
			f.dstSSHConn.on("ready", () => onDestinationSSHConnReady.call(f, flowType));
			f.dstSSHConn.on("error", (e) => {
				console.log("SSH connection error: " + e);
				stopTraffic();
			});
			f.dstSSHConn.config = {
				username: f.destination.user,
				host: f.destination.hostname,
				port: f.destination.port,
				privateKey: fs.readFileSync(".ssh/id_rsa")
			};
			f.dstSSHConn.connect(f.dstSSHConn.config);
		}
		f.data = {};
	});
	var plotter = spawn("feedgnuplot", feedgnuplotParams);
	plotter.stdout.on("data", (data) => onGnuplotData.call(plotter, flowType, data));
	plotter.stderr.on("data", (data) => {
		console.log("feedgnuplot stderr: %s", data);
		stopTraffic();
	});
	plotter.on("exit", (code) => {
		console.log("feedgnuplot process exited with code %s", code);
	});
	plotter.svg = "";
	state.plotter[flowType] = plotter;
}

function startTraffic() {
	["iperf", "ping"].forEach((flowType) => {
		var enabled = state.flows[flowType].filter((e) => { return e.enabled });
		startFlows(enabled, flowType);
	});
	state.running = true;
	state.clients = [];
}

function stopTraffic() {
	try {
	["iperf", "ping"].forEach((flowType) => {
		var enabled = state.flows[flowType].filter((e) => { return e.enabled });
		if (enabled.length) {
			enabled.forEach((f) => {
				if (typeof(f.srcSSHConn) != "undefined") { f.srcSSHConn.end() };
				if (typeof(f.dstSSHConn) != "undefined") { f.dstSSHConn.end() };
			});
			state.plotter[flowType].stdin.end();
		}
	});
	state.clients.forEach((stream) => {
		stream.close();
	});
	state.clients = [];
	state.running = false;
	} catch (e) {
		console.log(e);
		console.log(e.stack);
		throw(e);
	}
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
 *     plotter: {
 *         iperf: ChildProcess,
 *         ping: ChildProcess
 *     },
 *     flows: {
 *         iperf: [
 *             {
 *                 id: [uuidv4],
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
 *                 id: [uuidv4],
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
 * Warning: Throws exception!
 */
function createNewState(flowsString) {
	var newFlows = JSON.parse(flowsString);
	/* Append unique identifiers to each flow
	 * (to be distinguished by gnuplot) */
	["iperf", "ping"].forEach((type) => {
		newFlows.flows[type].forEach((f) => {
			f.id = uuidv4();
		});
	});
	console.log(JSON.stringify(newFlows));
	return {
		running: false,
		clients: [],
		plotter: { ping: {}, iperf: {} },
		flows: newFlows.flows
	};
}

/* The reason we start creating this from scratch is that
 * we put a lot of extraneous stuff in the state, such as data,
 * plotter, srcSSHConn, dstSSHConn, that we don't want to leak
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
			packetSize: f.packetSize,
			enabled: f.enabled,
			label: f.label
		});
	});
	return JSON.stringify({ flows: newFlows }, null, "\t");
}

function checkVersion(cmd, where, requiredMajor, requiredMinor) {
	try {
		var version = execSync(cmd).toString().split(" ")[where];
		var major, minor;
		[major, minor] = version.split(".").map(Number);
		return (major > requiredMajor ||
		       (major == requiredMajor && minor >= requiredMinor));
	} catch (e) {
		console.log(e);
		return false;
	}
}

if (!checkVersion("gnuplot --version", 1, 5, 2)) {
	/* Sample stdout: "gnuplot 5.2 patchlevel 0" */
	console.log("Please ensure a minimum version of gnuplot 5.2 is available.");
	process.exit();
}
if (!checkVersion("feedgnuplot --version", 2, 1, 45)) {
	/* Sample stdout: "feedgnuplot version 1.45" */
	console.log("Please ensure a minimum version of feedgnuplot 1.45 is available.");
	process.exit();
}

process.on("SIGHUP",  onExit);
process.on("SIGINT",  onExit);
process.on("SIGTERM", onExit);
process.on("SIGABRT", onExit);
process.on("SIGQUIT", onExit);

try {
	state = createNewState(readPlaintextFromFile("flows.json", false))
} catch (reason) {
	console.log(reason);
	console.log("initializing with empty iperf and ping flows array");
	state = {
		running: false,
		clients: [],
		plotter: { iperf: {}, ping: {} },
		flows: { iperf: [], ping: [] }
	};
};

server.on("request", onHttpRequest);
server.on("error", onHttpServerError);
server.listen(port, onHttpListen);
