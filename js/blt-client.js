var btnSave = document.getElementById("btnSave");
var btnStartStop = document.getElementById("btnStartStop");

var serverState = {
	running: false,
	iperfFlows: [],
	pingFlows: []
};

/* Type of e is InputEvent.
 * Type of e.target is HTMLTableCellElement. */
function changeFlow(e) {
	var parentRow = e.target;
	var text = e.target.innerText.trim();
	while (parentRow.nodeName.toLowerCase() != "tr") {
		parentRow = parentRow.parentElement;
	}
	var classes = e.target.classList;
	var index = parentRow.rowIndex - 1;
	if (classes.contains("iperf-source")) {
		serverState.iperfFlows[index].source = text;
	} else if (classes.contains("iperf-destination")) {
		serverState.iperfFlows[index].destination = text;
	} else if (classes.contains("iperf-port")) {
		serverState.iperfFlows[index].port = text;
	} else if (classes.contains("iperf-transport")) {
		serverState.iperfFlows[index].transport = text;
	} else if (classes.contains("iperf-bandwidth")) {
		serverState.iperfFlows[index].bandwidth = text;
	} else if (classes.contains("iperf-label")) {
		serverState.iperfFlows[index].label = text;
	} else if (classes.contains("iperf-enabled")) {
		serverState.iperfFlows[index].enabled = e.target.checked;
	} else if (classes.contains("ping-source")) {
		serverState.pingFlows[index].source = text;
	} else if (classes.contains("ping-destination")) {
		serverState.pingFlows[index].source = text;
	} else if (classes.contains("ping-interval-type")) {
		serverState.pingFlows[index].intervalType = text;
	} else if (classes.contains("ping-interval-ms")) {
		serverState.pingFlows[index].intervalMS = text;
	} else if (classes.contains("ping-packet-size")) {
		serverState.pingFlows[index].packetSize = text;
	} else if (classes.contains("ping-label")) {
		serverState.pingFlows[index].label = text;
	} else if (classes.contains("ping-enabled")) {
		serverState.pingFlows[index].enabled = e.target.checked;
	} else {
		window.alert("unrecognized change operation: row " + index +
		             ", text " + text + ", class list " + classes);
		return;
	}
	btnSave.disabled = false;
}

function addFlow() {
	var parentTable = this;
	while (parentTable.nodeName.toLowerCase() != "table") {
		parentTable = parentTable.parentElement;
		/* TODO: check case where there is no parent node element of type "table" */
	}
	switch (parentTable.id) {
		case "iperf-table":
			serverState.iperfFlows.push({source: "n/a", destination: "n/a", port: "n/a", transport: "n/a", bandwidth: "n/a", label: "n/a", enabled: false});
			displayServerState();
			break;
		case "ping-table":
			serverState.pingFlows.push({source: "n/a", destination: "n/a", intervalType: "n/a", intervalMS: "n/a", packetSize: "n/a", label: "n/a", enabled: false});
			displayServerState();
			break;
		default:
			window.alert("Invalid selection!");
			return;
	}
	btnSave.disabled = false;
}

function removeFlow() {
	var parentTable = this;
	while (parentTable.nodeName.toLowerCase() != "table") {
		parentTable = parentTable.parentElement;
		/* TODO: check case where there is no parent node element of type "table" */
	}
	var parentRow = this;
	while (parentRow.nodeName.toLowerCase() != "tr") {
		parentRow = parentRow.parentElement;
	}
	var indexToRemove = parentRow.rowIndex - 1;
	var flows;
	switch (parentTable.id) {
		case "iperf-table":
			flows = serverState.iperfFlows;
			break;
		case "ping-table":
			flows = serverState.pingFlows;
			break;
		default:
			window.alert("Invalid selection!");
			return;
	}
	if (indexToRemove < 0 || indexToRemove >= flows.length) {
		window.alert("cannot remove index " + indexToRemove +
		             " from flow array");
		return;
	}
	flows.splice(indexToRemove, 1);
	displayServerState();
	btnSave.disabled = false;
}

function displayServerState() {
	var iperfTable = document.getElementById("iperf-table").getElementsByTagName('tbody')[0];;
	var  pingTable = document.getElementById("ping-table").getElementsByTagName('tbody')[0];;
	var   editable = serverState.running ? "" : "contenteditable";

	iperfTable.innerHTML = "";
	for (i = 0; i < serverState.iperfFlows.length; i++) {
		var flow = serverState.iperfFlows[i];
		var newRow = iperfTable.insertRow(iperfTable.rows.length);
		/* we use the "editable" class to put input event listeners,
		 * and the other classes to easily discern in the common
		 * listener which field was changed */
		newRow.innerHTML =
			"<td><input type=\"checkbox\" class=\"editable iperf-enabled\"" +
				(flow.enabled ? " checked" : "") + (serverState.running ? " disabled" : "") + "></td>" +
			"<td " + editable + " class=\"editable iperf-label\">" + flow.label + "</td>" +
			"<td " + editable + " class=\"editable iperf-source\">" + flow.source + "</td>" +
			"<td " + editable + " class=\"editable iperf-destination\">" + flow.destination + "</td>" +
			"<td " + editable + " class=\"editable iperf-port\">" + flow.port + "</td>" +
			"<td " + editable + " class=\"editable iperf-transport\">" + flow.transport + "</td>" +
			"<td " + editable + " class=\"editable iperf-bandwidth\">" + flow.bandwidth + "</td>" +
			"<td><button type=\"button\" class=\"btnRemove\">-</button></td>"
			;
	}
	pingTable.innerHTML = "";
	for (i = 0; i < serverState.pingFlows.length; i++) {
		var flow = serverState.pingFlows[i];
		var newRow = pingTable.insertRow(pingTable.rows.length);
		newRow.innerHTML =
			"<td><input type=\"checkbox\" class=\"editable ping-enabled\"" +
				(flow.enabled ? " checked" : "") + (serverState.running ? " disabled" : "") + "></td>" +
			"<td " + editable + " class=\"editable ping-label\">" + flow.label + "</td>" +
			"<td " + editable + " class=\"editable ping-source\">" + flow.source + "</td>" +
			"<td " + editable + " class=\"editable ping-destination\">" + flow.destination + "</td>" +
			"<td " + editable + " class=\"editable ping-interval-type\">" + flow.intervalType + "</td>" +
			"<td " + editable + " class=\"editable ping-interval-ms\">" + flow.intervalMS + "</td>" +
			"<td " + editable + " class=\"editable ping-packet-size\">" + flow.packetSize + "</td>" +
			"<td><button type=\"button\" class=\"btnRemove\">-</button></td>"
			;
	}
	/* Put listeners again on DOM objects */
	var btnsAdd = document.getElementsByClassName("btnAdd");
	for (i = 0; i < btnsAdd.length; i++) {
		btnsAdd[i].onclick = addFlow;
		btnsAdd[i].disabled = serverState.running;
	}
	var btnsRemove = document.getElementsByClassName("btnRemove");
	for (i = 0; i < btnsRemove.length; i++) {
		btnsRemove[i].onclick = removeFlow;
		btnsRemove[i].disabled = serverState.running;
	}
	var editables = document.getElementsByClassName("editable");
	for (i = 0; i < editables.length; i++) {
		editables[i].oninput = changeFlow;
		editables[i].disabled = serverState.running;
	}
	btnStartStop.innerHTML = (serverState.running) ? "Stop traffic" : "Start traffic";
}

function xchgServerState(requestType, path, toSend) {
	return new Promise((resolve, reject) => {
		/* requestType is GET or PUT */
		var xhr = new XMLHttpRequest();
		xhr.open(requestType, path);
		xhr.setRequestHeader("Content-Type", "application/json");
		xhr.onload = function() {
			if (this.status >= 200 && this.status < 300) {
				try {
					resolve(JSON.parse(this.responseText));
				} catch (e) {
					reject(e);
				}
			} else {
				reject(new Error(this.status));
			}
		};
		if (requestType == "PUT") {
			xhr.send(JSON.stringify(toSend));
		} else if (requestType == "GET") {
			xhr.send();
		}
	});
}

function onSSEEvent(event) {
	try {
		var msg = JSON.parse(event.data);
		var dom_node;
		switch (event.type) {
		case "iperf":
			dom_node = document.getElementById("iperf-gnuplot");
			break;
		case "ping":
			dom_node = document.getElementById("ping-gnuplot");
			break;
		default:
			throw new Error("invalid event type " + event.type);
		}
		dom_node.innerHTML = msg.svg;
	} catch (e) {
		window.alert(e.name + ' while parsing event "' + event.data +
		             ' from server: ' + e.message);
	}
}

function initSSE() {
	sseStream = new EventSource("/sse");
	sseStream.onopen = function() {
		console.log("sse :: connection opened");
	};
	sseStream.onerror = function (event) {
		console.log("sse :: connection error");
		console.log(event);
		sseStream.close();
		refresh();
	};
	sseStream.onmessage = function (event) {
		console.log("sse stream message: " + event.data);
	};
	sseStream.onclose = function(code, reason) {
		console.log("sse :: connection closed");
		console.log(code, reason);
	};
	sseStream.addEventListener("iperf", onSSEEvent);
	/* Close the connection when the window is closed */
	window.addEventListener("beforeunload", closeSSE);
}

function closeSSE() {
	if (typeof(sseStream) != "undefined") { sseStream.close(); }
}

function onServerStateChanged(newState) {
	if (typeof (newState.flows) != "undefined") {
		serverState.iperfFlows = newState.flows.iperfFlows;
		serverState.pingFlows = newState.flows.pingFlows;
	}
	if (typeof (newState.running) != "undefined") {
		if (serverState.running == false && newState.running == true) {
			serverState.running = true;
			initSSE();
		} else if (serverState.running == true && newState.running == false) {
			serverState.running = false;
			closeSSE();
			document.getElementById("iperf-gnuplot").innerHTML = "";
			document.getElementById("ping-gnuplot").innerHTML = "";
		}
	}
	displayServerState();
}

function refresh() {
	Promise.all([
		xchgServerState("GET", "/flows"),
		xchgServerState("GET", "/running")
	])
	.then((array) => {
		onServerStateChanged({
			flows: array[0],
			running: array[1].running
		});
	})
	.catch((reason) => { console.log(reason); });
};

window.onload = refresh;
btnSave.onclick = function() {
	xchgServerState("PUT", "/flows", {
		iperfFlows: serverState.iperfFlows,
		pingFlows: serverState.pingFlows
	})
	.then((flows) => { onServerStateChanged({flows: flows}); })
	.catch((reason) => { console.log(reason); });
};
btnStartStop.onclick = function() {
	xchgServerState("PUT", "/running", {
		running: !serverState.running
	})
	.then((state) => { onServerStateChanged({ running: state.running }); })
	.catch((reason) => { console.log(reason); });
};
