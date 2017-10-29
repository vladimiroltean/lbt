#!/usr/bin/env nodejs

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
				response.statusCode = 405;
				response.end();
				break;
			}
			request.on("data", function onData(data) {
				createNewState(data,
					function onSuccess(newState) {
						state = newState;
						var flowsString = JSON.stringify({ "iperfFlows": state.iperfFlows, "pingFlows": state.pingFlows });
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
var server = http.createServer();
var url = require("url");
var port = 8000;
var html = readPlaintextFromFile("index.html", true);
var blt_client_js = readPlaintextFromFile("js/blt-client.js", true);
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
