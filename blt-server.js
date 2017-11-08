#!/usr/bin/env node

var fs = require("fs");
var http = require("http");
var sshClient = require("ssh2").Client;
var server = http.createServer();
var html = readPlaintextFromFile("index.html", true);
var blt_client_js = readPlaintextFromFile("js/blt-client.js", true);
var { spawn, execSync } = require("child_process");
var uuidv4 = require('uuid/v4');
var config = JSON.parse(readPlaintextFromFile("config.json", true));
var sshPrivateKey = readPlaintextFromFile(config.sshPrivateKey, true);
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

/* Method of objects from the state.flows[flowType] arrays */
function onSourceSSHConnReady(flowType) {
	var cmd;

	if (flowType == "iperf") {
		/* Run for 24 hours */
		cmd = "iperf3 -t 86400 -p " + this.port +
		      ((this.transport == "udp") ? " -u -b " + this.bandwidth + "M " : " ") +
		       " -c " + this.destination.hostname;
	} else {
		cmd = "ping " + ((this.intervalType == "adaptive") ? "-A " :
		                 (this.intervalType == "flood") ? "-f " :
		                 "-i " + (this.intervalMS / 1000)) +
		       " -s " + this.packetSize + " " + this.destination.hostname;
	}

	this.startTime = Date.now();
	console.log("%s %s Client :: conn ready", this.label, flowType);
	this.srcSSHConn.exec(cmd, { pty: true }, (err, stream) => {
		if (err) {
			console.log(err);
			this.srcSSHConn.end();
			stopTraffic(err);
			return;
		}
		stream.on("close", (code, signal) => {
			var msg = this.label + " " + flowType + " Source :: close :: code: " +
			          code + ", signal: " + signal;
			console.log(msg);
			this.srcSSHConn.end();
			if (code || signal) {
				/* Abnormal termination. Notify browser. */
				stopTraffic(new Error(msg));
			} else {
				stopTraffic();
			}
		});
		stream.on("data", (data) => {
			if (flowType == "ping") {
				stream.on("data", (data) => {
					if (data.includes("ms")) {
						var words = data.toString().trim().split(/\ +/);
						var rtt = words[words.indexOf("ms") - 1].split("=")[1];
						var time = (Date.now() - this.startTime) / 1000;
						/* Plot an extra ping point */
						state.plotter[flowType].stdin.write(
								time + " " + this.id + " " + rtt + "\n");
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
			var msg = this.label + " " + flowType + " Source :: STDERR " + data;
			console.log(msg);
			this.srcSSHConn.end();
			stopTraffic(new Error(msg));
		});
	});
}

/* Method of objects from the state.flows[flowType] arrays */
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
			stopTraffic(err);
			return;
		}
		stream.on("close", (code, signal) => {
			var msg = this.label + " " + flowType + " Destination :: close :: code: " +
			          code + ", signal: " + signal;
			console.log(msg);
			if (code || signal) {
				stopTraffic(new Error(msg));
			} else {
				stopTraffic();
			}
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
					state.plotter[flowType].stdin.write(
							time + " " + this.id + " " + bw + "\n");
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
			var msg = this.label + " " + flowType + " Destination :: STDERR " + data;
			console.log(msg);
			this.dstSSHConn.end();
			stopTraffic(new Error(msg));
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

	var feedgnuplotParams = [
		"--stream", "0.5",
		"--domain", /* First column (time) is domain */
		"--dataid", /* Second column (f.id) is dataid */
		"--exit",
		"--lines",
		"--terminal", "svg"
	];
	if (config[flowType].xmin)   feedgnuplotParams.push("--xmin",   config[flowType].xmin);
	if (config[flowType].ymin)   feedgnuplotParams.push("--ymin",   config[flowType].ymin);
	if (config[flowType].xmax)   feedgnuplotParams.push("--xmax",   config[flowType].xmax);
	if (config[flowType].ymax)   feedgnuplotParams.push("--ymax",   config[flowType].ymax);
	if (config[flowType].xlen)   feedgnuplotParams.push("--xlen",   config[flowType].xlen);
	if (config[flowType].xlabel) feedgnuplotParams.push("--xlabel", config[flowType].xlabel);
	if (config[flowType].ylabel) feedgnuplotParams.push("--ylabel", config[flowType].ylabel);
	if (config[flowType].title)  feedgnuplotParams.push("--title",  config[flowType].title);
	if (config[flowType].plotStyle == "histogram" && config[flowType].binwidth) {
		feedgnuplotParams.push("--binwidth",  config[flowType].binwidth);
	}
	/* "--timefmt", "%H:%M:%S", "--set", 'format x "%H:%M:%S"', */

	flows.forEach((f) => {
		if (config[flowType].plotStyle == "histogram") {
			feedgnuplotParams.push("--legend", f.id, f.label);
			feedgnuplotParams.push("--histogram", f.id);
		} else {
			feedgnuplotParams.push("--style", f.id, 'linewidth 2');
			feedgnuplotParams.push("--legend", f.id, f.label);
		}

		f.srcSSHConn = new sshClient();
		f.srcSSHConn.on("ready", () => onSourceSSHConnReady.call(f, flowType));
		f.srcSSHConn.on("error", (e) => {
			var msg = "SSH connection error: " + e;
			console.log(msg);
			stopTraffic(new Error(msg));
		});
		f.srcSSHConn.config = {
			username: f.source.user,
			host: f.source.hostname,
			port: f.source.port,
			privateKey: sshPrivateKey
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
				var msg = "SSH connection error: " + e;
				console.log(msg);
				stopTraffic(new Error(msg));
			});
			f.dstSSHConn.config = {
				username: f.destination.user,
				host: f.destination.hostname,
				port: f.destination.port,
				privateKey: sshPrivateKey
			};
			f.dstSSHConn.connect(f.dstSSHConn.config);
		}
		f.data = {};
	});
	var plotter = spawn("feedgnuplot", feedgnuplotParams);
	plotter.stdout.on("data", (data) => onGnuplotData.call(plotter, flowType, data));
	plotter.stderr.on("data", (data) => {
		console.log("feedgnuplot stderr: %s", data);
		/* Some warning messages are not harmful */
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

function stopTraffic(error) {
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
		if (typeof error != "undefined") {
			stream.send("error", JSON.stringify({ error: error.message }));
		}
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
	console.log("Server listening for http requests on port %s",
	            config.listenPort);
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
server.listen(config.listenPort, onHttpListen);
