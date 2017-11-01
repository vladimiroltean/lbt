#!/usr/bin/env node

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
			var flows = { "iperfFlows": state.iperfFlows, "pingFlows": state.pingFlows };
			response.end(JSON.stringify(flows));
			break;
		case "/running":
			response.setHeader("Content-Type", "text/plain");
			response.end(state.trafficRunning.toString());
			break;
		default:
			response.statusCode = 404;
			response.end();
			break;
		}
		break;
	case "PUT":
		console.log("PUT " + request.url);
		switch (request.url) {
		/* Only REST method calls */
		case "/flows":
			if (state.trafficRunning == true) {
				/* Do not allow changes to flow configuration while traffic is running */
				response.setHeader("Content-Type", "text/plain");
				response.statusCode = 405;
				response.end();
				break;
			}
			request.on("data", function onData(data) {
				createNewState(data,
					function onSuccess(newState) {
						state = newState;
						var flowsString = JSON.stringify({ "iperfFlows": state.iperfFlows, "pingFlows": state.pingFlows });
						response.setHeader("Content-Type", "application/json");
						response.end(flowsString);
						fs.writeFile("flows.json", flowsString, function onWrite() {
							console.log("Successfully written flows to file.");
						});
					},
					function onFail() {
						console.log("cannot parse flows from " + data);
						response.statusCode = 400;
						response.end();
					}
				);
			});
			break;
		case "/running":
			request.on("data", function onData(data) {
				if (data == "true") {
					onStartStopTraffic(true);
				} else if (data == "false") {
					onStartStopTraffic(false);
				} else {
					console.log("invalid request body " + data);
					response.statusCode = 400;
					response.end();
					return;
				}
				response.setHeader("Content-Type", "text/plain");
				response.end(state.trafficRunning.toString());
			});
			break;
		default:
			response.statusCode = 405;
			response.end();
			break;
		}
		break;
	default:
		console.log("Unknown method %s called", request.method);
		response.statusCode = 405;
		response.end();
		break;
	}
}

/* this == f->clientConn */
function onIperfClientConnReady() {
	var flow = this.backlink;
	var iperfCmd = "iperf3 -p " + flow.port + " -c " + flow.destination.split("@")[1];

	console.log("iperf Client for %s :: conn ready", flow.label);
	this.exec(iperfCmd, { pty: true }, (err, stream) => {
		if (err) throw err;
		stream.on("close", (code, signal) => {
			console.log("iperf Client for %s :: close :: code: %s, signal: %s", flow.label, code, signal);
			this.end();
		});
		stream.on("data", (data) => {
			console.log("STDOUT: %s", data);
		});
		stream.stderr.on("data", (data) => {
			console.log("STDERR: %s", data);
		});
	});
}

function replotIperf() {
	var enabledFlows = {
		iperfFlows: state.iperfFlows.filter(function(e) { return e.enabled }),
		pingFlows: state.pingFlows.filter(function(e) { return e.enabled })
	};
	var iperfData = {};
	enabledFlows.iperfFlows.forEach((f) => {
		iperfData[f.label] = f.data;
	});
	state.iperfFlows.plotter.stdin.write(JSON.stringify({
		data: iperfData,
		format: "svg",
		filename: "output.svg"
	}));
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
				/* replotIperf(); */
				state.iperfFlows.plotter.stdin.write(time + " " + flow.label + " " + bw + "\n");
			} else {
				console.log("%s Server STDOUT: %s", flow.label, data);
			}
		});
		stream.stderr.on("data", (data) => {
			console.log("%s Server STDERR: %s", flow.label, data);
		});
	});
}

function startTraffic(enabledFlows) {
	enabledFlows.iperfFlows.forEach(function (f) {
		var srcArr = f.source.split("@");
		var dstArr = f.destination.split("@");

		f.clientConn = new sshClient();
		f.clientConn.backlink = f;
		f.clientConn.on("ready", onIperfClientConnReady);
		f.clientConn.on("error", (e) => {
			console.log("SSH connection error: " + e);
			stopTraffic(enabledFlows);
		});
		f.clientConn.config = {
			username: srcArr[0],
			host: srcArr[1],
			port: 22,
			privateKey: fs.readFileSync(".ssh/id_rsa")
		};

		f.serverConn = new sshClient();
		f.serverConn.backlink = f;
		f.serverConn.on("ready", onIperfServerConnReady);
		f.serverConn.on("error", (e) => {
			console.log("SSH connection error: " + e);
			stopTraffic(enabledFlows);
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
	state.trafficRunning = true;
	state.iperfFlows.plotter = spawn("feedgnuplot", iperfParams);
	state.iperfFlows.plotter.stdout.on("data", (data) => {
		if (data.includes('<?xml version="1.0"')) {
			/* New SVG coming. Do something with the old one. */
			console.log("new svg %s", state.iperfFlows.plotter.svg);
			state.iperfFlows.plotter.svg = data;
		} else {
			state.iperfFlows.plotter.svg += data;
		}
	});
	state.iperfFlows.plotter.stderr.on("data", (data) => {
		console.log("feedgnuplot stderr: %s", data);
	});
	state.iperfFlows.plotter.on("exit", (code) => {
		console.log("feedgnuplot process exited with code %s", code);
	});
	state.iperfFlows.plotter.svg = "";
}

function stopTraffic(enabledFlows) {
	enabledFlows.iperfFlows.forEach(function (f) {
		if (f.clientConn !== undefined) { f.clientConn.end() };
		if (f.serverConn !== undefined) { f.serverConn.end() };
	});
	state.iperfFlows.plotter.stdin.end();
	state.trafficRunning = false;
}

function onStartStopTraffic(newTrafficState) {
	console.log("traffic start/stop: old state " + state.trafficRunning + ", new state " + newTrafficState);
	var enabledFlows = {
		iperfFlows: state.iperfFlows.filter(function(e) { return e.enabled }),
		pingFlows: state.pingFlows.filter(function(e) { return e.enabled })
	};
	switch (newTrafficState) {
	case true:
		startTraffic(enabledFlows);
		break;
	case false:
		stopTraffic(enabledFlows);
		break;
	}
}

function onHttpListen() {
	console.log("Server listening for http requests on port " + port);
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
 *     trafficRunning: boolean,
 *     iperfFlows: [
 *         source: "user@host",
 *         destination: "user@host",
 *         port: integer,
 *         transport: "tcp|udp",
 *         bandwidth: integer,
 *         enabled: boolean,
 *         label: string,
 *         data: [],
 *     ],
 *     pingFlows: [
 *         source: "user@host",
 *         destination: "user@host",
 *         intervalType: "periodic|adaptive|flood",
 *         intervalMS: integer,
 *         enabled: boolean,
 *         label: string,
 *         data: []
 *     ],
 * };
 */

/* We create a new state object from the given flowsString
 * interpreted as JSON.
 * state.trafficRunning always gets initialized as false, because
 * it is not semantically correct anyway to call this function
 * while trafficRunning == true.
 */
function createNewState(flowsString, onSuccess, onFail) {
	var state;
	var flows;
	try {
		flows = JSON.parse(flowsString);
		state = { trafficRunning: false, iperfFlows: flows.iperfFlows, pingFlows: flows.pingFlows };
		onSuccess(state);
	} catch (e) {
		console.log(e.name + ": " + e.message);
		onFail();
	}
	return;
}

process.on("SIGHUP",  onExit);
process.on("SIGINT",  onExit);
process.on("SIGTERM", onExit);
process.on("SIGABRT", onExit);
process.on("SIGQUIT", onExit);

var fs = require("fs");
var http = require("http");
var sshClient = require("ssh2").Client;
var server = http.createServer();
var url = require("url");
var port = 8000;
var html = readPlaintextFromFile("index.html", true);
var blt_client_js = readPlaintextFromFile("js/blt-client.js", true);
var spawn = require("child_process").spawn;
var state;
createNewState(readPlaintextFromFile("flows.json", false),
	function onSuccess(newState) {
		state = newState;
	},
	function onFail() {
		console.log("initializing with empty iperf and ping flows array");
		state = { trafficRunning: false, iperfFlows: [], pingFlows: [] };
	}
);

server.on("request", onHttpRequest);
server.on("error", onHttpServerError);
server.listen(port, onHttpListen);
